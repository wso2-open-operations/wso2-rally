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

package events

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
)

// eventColumns is the shared projection, kept in one place so Get and Search
// cannot drift apart.
const eventColumns = `
	id, name, event_date, start_time, status,
	start_label, start_lat, start_lng, start_radius_m,
	end_label, end_lat, end_lng, end_radius_m,
	cipher, created_by, created_on`

// sqlRepo is the MySQL-backed Repo.
type sqlRepo struct {
	db *sql.DB
}

// NewRepo returns a Repo backed by the given database.
func NewRepo(db *sql.DB) Repo {
	return &sqlRepo{db: db}
}

func (r *sqlRepo) Create(ctx context.Context, e Event) error {
	const query = `
		INSERT INTO event (
			id, name, event_date, start_time, status,
			start_label, start_lat, start_lng, start_radius_m,
			end_label, end_lat, end_lng, end_radius_m,
			cipher, created_by, created_on
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := r.db.ExecContext(ctx, query,
		e.ID, e.Name, e.EventDate, e.StartTime, string(e.Status),
		nullString(e.Start.Label), e.Start.Lat, e.Start.Lng, e.Start.RadiusM,
		nullString(e.End.Label), e.End.Lat, e.End.Lng, e.End.RadiusM,
		nullString(e.Cipher), e.CreatedBy, e.CreatedOn,
	)
	if err != nil {
		return fmt.Errorf("insert event: %w", err)
	}

	return nil
}

func (r *sqlRepo) Get(ctx context.Context, id string) (Event, error) {
	query := "SELECT " + eventColumns + " FROM event WHERE id = ?"

	event, err := scanEvent(r.db.QueryRowContext(ctx, query, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Event{}, ErrNotFound
	}
	if err != nil {
		return Event{}, fmt.Errorf("select event %s: %w", id, err)
	}

	byEvent, err := r.routeRefsOf(ctx, event.ID)
	if err != nil {
		return Event{}, err
	}
	event.Routes = byEvent[event.ID]

	return event, nil
}

func (r *sqlRepo) Update(ctx context.Context, e Event) error {
	const query = `
		UPDATE event SET
			name = ?, event_date = ?, start_time = ?, status = ?,
			start_label = ?, start_lat = ?, start_lng = ?, start_radius_m = ?,
			end_label = ?, end_lat = ?, end_lng = ?, end_radius_m = ?,
			cipher = ?
		WHERE id = ?`

	result, err := r.db.ExecContext(ctx, query,
		e.Name, e.EventDate, e.StartTime, string(e.Status),
		nullString(e.Start.Label), e.Start.Lat, e.Start.Lng, e.Start.RadiusM,
		nullString(e.End.Label), e.End.Lat, e.End.Lng, e.End.RadiusM,
		nullString(e.Cipher), e.ID,
	)
	if err != nil {
		return fmt.Errorf("update event %s: %w", e.ID, err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update event %s: %w", e.ID, err)
	}
	// Zero rows means the id vanished between the read and the write. MySQL
	// also reports zero when the values are unchanged, so confirm before
	// declaring the event missing.
	if affected == 0 {
		if _, getErr := r.Get(ctx, e.ID); getErr != nil {
			return getErr
		}
	}

	return nil
}

func (r *sqlRepo) Search(ctx context.Context, page httpx.Page, filter SearchFilter) ([]Event, int, error) {
	where, args := "", []any{}
	if filter.Status != "" {
		where = " WHERE status = ?"
		args = append(args, string(filter.Status))
	}

	var total int
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM event"+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count events: %w", err)
	}
	if total == 0 {
		return nil, 0, nil
	}

	query := "SELECT " + eventColumns + " FROM event" + where + " ORDER BY event_date DESC, created_on DESC LIMIT ? OFFSET ?"
	rows, err := r.db.QueryContext(ctx, query, append(args, page.Limit, page.Offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("select events: %w", err)
	}
	defer func() { _ = rows.Close() }()

	found := make([]Event, 0, page.Limit)
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scan event: %w", err)
		}
		found = append(found, event)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate events: %w", err)
	}

	ids := make([]string, 0, len(found))
	for _, e := range found {
		ids = append(ids, e.ID)
	}
	byEvent, err := r.routeRefsOf(ctx, ids...)
	if err != nil {
		return nil, 0, err
	}
	for i := range found {
		found[i].Routes = byEvent[found[i].ID]
	}

	return found, total, nil
}

// routeRefsOf loads the route names of every given event in one round trip, so
// a page of events costs two queries rather than one per row.
func (r *sqlRepo) routeRefsOf(ctx context.Context, eventIDs ...string) (map[string][]RouteRef, error) {
	byEvent := map[string][]RouteRef{}
	if len(eventIDs) == 0 {
		return byEvent, nil
	}

	args := make([]any, 0, len(eventIDs))
	for _, id := range eventIDs {
		args = append(args, id)
	}
	query := "SELECT event_id, id, name FROM route WHERE event_id IN (?" +
		strings.Repeat(", ?", len(eventIDs)-1) + ") ORDER BY display_order, name"

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("select event routes: %w", err)
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var (
			eventID string
			ref     RouteRef
		)
		if err := rows.Scan(&eventID, &ref.ID, &ref.Name); err != nil {
			return nil, fmt.Errorf("scan event route: %w", err)
		}
		byEvent[eventID] = append(byEvent[eventID], ref)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate event routes: %w", err)
	}

	return byEvent, nil
}

// Stats counts an event's fleet, crews, tasks and unresolved alerts in one
// round trip. Crews and alerts hang off vehicle, so both reach the event
// through it.
func (r *sqlRepo) Stats(ctx context.Context, eventID string) (Stats, error) {
	const query = `
		SELECT
			(SELECT COUNT(*) FROM vehicle WHERE event_id = ?),
			(SELECT COUNT(*) FROM crew_member c
				JOIN vehicle v ON v.id = c.vehicle_id
				WHERE v.event_id = ?),
			(SELECT COUNT(*) FROM task WHERE event_id = ?),
			(SELECT COUNT(*) FROM vehicle_alert a
				JOIN vehicle v ON v.id = a.vehicle_id
				WHERE v.event_id = ? AND a.resolved_at IS NULL)`

	var stats Stats
	err := r.db.QueryRowContext(ctx, query, eventID, eventID, eventID, eventID).
		Scan(&stats.Vehicles, &stats.Crews, &stats.Tasks, &stats.OpenAlerts)
	if err != nil {
		return Stats{}, fmt.Errorf("count event %s stats: %w", eventID, err)
	}

	return stats, nil
}

// rowScanner is satisfied by both *sql.Row and *sql.Rows, letting Get and
// Search share one scan.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanEvent(row rowScanner) (Event, error) {
	var (
		e                    Event
		status               string
		startLabel, endLabel sql.NullString
		cipher               sql.NullString
	)
	err := row.Scan(
		&e.ID, &e.Name, &e.EventDate, &e.StartTime, &status,
		&startLabel, &e.Start.Lat, &e.Start.Lng, &e.Start.RadiusM,
		&endLabel, &e.End.Lat, &e.End.Lng, &e.End.RadiusM,
		&cipher, &e.CreatedBy, &e.CreatedOn,
	)
	if err != nil {
		return Event{}, err
	}

	e.Status = Status(status)
	e.Start.Label = startLabel.String
	e.End.Label = endLabel.String
	e.Cipher = cipher.String

	return e, nil
}

// nullString stores an empty optional string as SQL NULL rather than "".
func nullString(s string) any {
	if s == "" {
		return nil
	}

	return s
}
