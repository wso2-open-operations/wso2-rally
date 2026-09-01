// Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

package routes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
)

type sqlRepo struct {
	db *sql.DB
}

// NewRepo returns a Repo backed by the given database.
func NewRepo(db *sql.DB) Repo {
	return &sqlRepo{db: db}
}

func (r *sqlRepo) CreateRoute(ctx context.Context, route Route) error {
	const query = `INSERT INTO route (id, event_id, name, display_order) VALUES (?, ?, ?, ?)`

	_, err := r.db.ExecContext(ctx, query, route.ID, route.EventID, route.Name, route.Order)
	if store.IsDuplicateKey(err) {
		return ErrDuplicateName
	}
	if err != nil {
		return fmt.Errorf("insert route: %w", err)
	}

	return nil
}

func (r *sqlRepo) GetRoute(ctx context.Context, id string) (Route, error) {
	const query = `SELECT id, event_id, name, display_order FROM route WHERE id = ?`

	var route Route
	err := r.db.QueryRowContext(ctx, query, id).Scan(&route.ID, &route.EventID, &route.Name, &route.Order)
	if errors.Is(err, sql.ErrNoRows) {
		return Route{}, ErrRouteNotFound
	}
	if err != nil {
		return Route{}, fmt.Errorf("select route %s: %w", id, err)
	}

	return route, nil
}

func (r *sqlRepo) ListRoutes(ctx context.Context, eventID string) ([]Route, error) {
	const query = `
		SELECT id, event_id, name, display_order
		FROM route WHERE event_id = ?
		ORDER BY display_order, name`

	rows, err := r.db.QueryContext(ctx, query, eventID)
	if err != nil {
		return nil, fmt.Errorf("select routes: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var found []Route
	for rows.Next() {
		var route Route
		if err := rows.Scan(&route.ID, &route.EventID, &route.Name, &route.Order); err != nil {
			return nil, fmt.Errorf("scan route: %w", err)
		}
		found = append(found, route)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate routes: %w", err)
	}

	return found, nil
}

func (r *sqlRepo) UpdateRoute(ctx context.Context, route Route) error {
	const query = `UPDATE route SET name = ?, display_order = ? WHERE id = ?`

	result, err := r.db.ExecContext(ctx, query, route.Name, route.Order, route.ID)
	if store.IsDuplicateKey(err) {
		return ErrDuplicateName
	}
	if err != nil {
		return fmt.Errorf("update route %s: %w", route.ID, err)
	}

	return confirmRowExists(ctx, result, func() error {
		_, getErr := r.GetRoute(ctx, route.ID)
		return getErr
	})
}

// ListWaypoints returns a route's waypoints in driving order, each with the
// ids of its attached tasks.
//
// The attachments are fetched in one extra query rather than per waypoint, so
// the cost stays flat as a route grows.
func (r *sqlRepo) ListWaypoints(ctx context.Context, routeID string) ([]Waypoint, error) {
	const query = `
		SELECT id, route_id, display_order, label, lat, lng, boundary_radius_m
		FROM waypoint WHERE route_id = ?
		ORDER BY display_order`

	rows, err := r.db.QueryContext(ctx, query, routeID)
	if err != nil {
		return nil, fmt.Errorf("select waypoints: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var (
		found []Waypoint
		byID  = map[string]int{}
	)
	for rows.Next() {
		var w Waypoint
		if err := rows.Scan(&w.ID, &w.RouteID, &w.Order, &w.Label, &w.Lat, &w.Lng, &w.BoundaryRadiusM); err != nil {
			return nil, fmt.Errorf("scan waypoint: %w", err)
		}
		byID[w.ID] = len(found)
		found = append(found, w)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate waypoints: %w", err)
	}
	if len(found) == 0 {
		return nil, nil
	}

	if err := r.loadTaskIDs(ctx, routeID, found, byID); err != nil {
		return nil, err
	}

	return found, nil
}

func (r *sqlRepo) loadTaskIDs(ctx context.Context, routeID string, waypoints []Waypoint, byID map[string]int) error {
	const query = `
		SELECT wt.waypoint_id, wt.task_id
		FROM waypoint_task wt
		JOIN waypoint w ON w.id = wt.waypoint_id
		WHERE w.route_id = ?
		ORDER BY wt.waypoint_id, wt.display_order`

	rows, err := r.db.QueryContext(ctx, query, routeID)
	if err != nil {
		return fmt.Errorf("select waypoint tasks: %w", err)
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var waypointID, taskID string
		if err := rows.Scan(&waypointID, &taskID); err != nil {
			return fmt.Errorf("scan waypoint task: %w", err)
		}
		if idx, ok := byID[waypointID]; ok {
			waypoints[idx].TaskIDs = append(waypoints[idx].TaskIDs, taskID)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate waypoint tasks: %w", err)
	}

	return nil
}

func (r *sqlRepo) GetWaypoint(ctx context.Context, id string) (Waypoint, error) {
	const query = `
		SELECT id, route_id, display_order, label, lat, lng, boundary_radius_m
		FROM waypoint WHERE id = ?`

	var w Waypoint
	err := r.db.QueryRowContext(ctx, query, id).
		Scan(&w.ID, &w.RouteID, &w.Order, &w.Label, &w.Lat, &w.Lng, &w.BoundaryRadiusM)
	if errors.Is(err, sql.ErrNoRows) {
		return Waypoint{}, ErrWaypointNotFound
	}
	if err != nil {
		return Waypoint{}, fmt.Errorf("select waypoint %s: %w", id, err)
	}

	taskIDs, err := r.taskIDsOf(ctx, id)
	if err != nil {
		return Waypoint{}, err
	}
	w.TaskIDs = taskIDs

	return w, nil
}

func (r *sqlRepo) taskIDsOf(ctx context.Context, waypointID string) ([]string, error) {
	const query = `SELECT task_id FROM waypoint_task WHERE waypoint_id = ? ORDER BY display_order`

	rows, err := r.db.QueryContext(ctx, query, waypointID)
	if err != nil {
		return nil, fmt.Errorf("select tasks of waypoint %s: %w", waypointID, err)
	}
	defer func() { _ = rows.Close() }()

	var taskIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan waypoint task: %w", err)
		}
		taskIDs = append(taskIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate waypoint tasks: %w", err)
	}

	return taskIDs, nil
}

func (r *sqlRepo) CreateWaypoint(ctx context.Context, w Waypoint) error {
	const query = `
		INSERT INTO waypoint (id, route_id, display_order, label, lat, lng, boundary_radius_m)
		VALUES (?, ?, ?, ?, ?, ?, ?)`

	_, err := r.db.ExecContext(ctx, query, w.ID, w.RouteID, w.Order, w.Label, w.Lat, w.Lng, w.BoundaryRadiusM)
	if err != nil {
		return fmt.Errorf("insert waypoint: %w", err)
	}

	return nil
}

func (r *sqlRepo) UpdateWaypoint(ctx context.Context, w Waypoint) error {
	const query = `
		UPDATE waypoint SET label = ?, lat = ?, lng = ?, boundary_radius_m = ?
		WHERE id = ?`

	result, err := r.db.ExecContext(ctx, query, w.Label, w.Lat, w.Lng, w.BoundaryRadiusM, w.ID)
	if err != nil {
		return fmt.Errorf("update waypoint %s: %w", w.ID, err)
	}

	return confirmRowExists(ctx, result, func() error {
		_, getErr := r.GetWaypoint(ctx, w.ID)
		return getErr
	})
}

// ReorderWaypoints renumbers the whole route in one transaction so a crew
// mid-rally never sees a half-applied sequence.
func (r *sqlRepo) ReorderWaypoints(ctx context.Context, routeID string, orderedIDs []string) error {
	const query = `UPDATE waypoint SET display_order = ? WHERE id = ? AND route_id = ?`

	return store.InTx(ctx, r.db, func(tx *sql.Tx) error {
		stmt, err := tx.PrepareContext(ctx, query)
		if err != nil {
			return fmt.Errorf("prepare reorder: %w", err)
		}
		defer func() { _ = stmt.Close() }()

		for position, id := range orderedIDs {
			result, err := stmt.ExecContext(ctx, position, id, routeID)
			if err != nil {
				return fmt.Errorf("reorder waypoint %s: %w", id, err)
			}
			affected, err := result.RowsAffected()
			if err != nil {
				return fmt.Errorf("reorder waypoint %s: %w", id, err)
			}
			// Zero rows here means the id is not on this route. The service
			// already checked, so this is a concurrent edit: abort the lot.
			if affected == 0 {
				var exists int
				err := tx.QueryRowContext(ctx,
					"SELECT COUNT(*) FROM waypoint WHERE id = ? AND route_id = ? AND display_order = ?",
					id, routeID, position).Scan(&exists)
				if err != nil {
					return fmt.Errorf("verify waypoint %s: %w", id, err)
				}
				if exists == 0 {
					return ErrWaypointNotFound
				}
			}
		}

		return nil
	})
}

// DeleteWaypoint removes a waypoint and closes the gap it leaves in the route's
// display_order, both inside one transaction so no reader sees the sequence
// with a hole in it. Attachments and visit rows go with it by cascade;
// session.current_waypoint_id and task_submission.waypoint_id are nulled.
func (r *sqlRepo) DeleteWaypoint(ctx context.Context, routeID, waypointID string) error {
	return store.InTx(ctx, r.db, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, "DELETE FROM waypoint WHERE id = ? AND route_id = ?", waypointID, routeID)
		if err != nil {
			return fmt.Errorf("delete waypoint %s: %w", waypointID, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("read affected rows: %w", err)
		}
		if affected == 0 {
			return ErrWaypointNotFound
		}

		const renumber = `
			UPDATE waypoint w
			JOIN (
				SELECT id, ROW_NUMBER() OVER (ORDER BY display_order, id) - 1 AS position
				FROM waypoint WHERE route_id = ?
			) ranked ON ranked.id = w.id
			SET w.display_order = ranked.position`
		if _, err := tx.ExecContext(ctx, renumber, routeID); err != nil {
			return fmt.Errorf("renumber waypoints of route %s: %w", routeID, err)
		}

		return nil
	})
}

// AttachTasks replaces a waypoint's attachments inside one transaction, so the
// waypoint is never briefly task-less from a reader's point of view.
func (r *sqlRepo) AttachTasks(ctx context.Context, waypointID string, taskIDs []string) error {
	return store.InTx(ctx, r.db, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "DELETE FROM waypoint_task WHERE waypoint_id = ?", waypointID); err != nil {
			return fmt.Errorf("clear tasks of waypoint %s: %w", waypointID, err)
		}
		if len(taskIDs) == 0 {
			return nil
		}

		const query = `INSERT INTO waypoint_task (waypoint_id, task_id, display_order) VALUES (?, ?, ?)`
		stmt, err := tx.PrepareContext(ctx, query)
		if err != nil {
			return fmt.Errorf("prepare attach: %w", err)
		}
		defer func() { _ = stmt.Close() }()

		for position, taskID := range taskIDs {
			if _, err := stmt.ExecContext(ctx, waypointID, taskID, position); err != nil {
				return fmt.Errorf("attach task %s: %w", taskID, err)
			}
		}

		return nil
	})
}

// confirmRowExists turns a zero-row UPDATE into a not-found error, but only
// after checking: MySQL also reports zero rows when an update is a no-op.
func confirmRowExists(_ context.Context, result sql.Result, check func() error) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read affected rows: %w", err)
	}
	if affected == 0 {
		return check()
	}

	return nil
}
