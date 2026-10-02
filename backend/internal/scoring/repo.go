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

package scoring

import (
	"context"
	"database/sql"
	"fmt"
)

type sqlRepo struct {
	db *sql.DB
}

// NewRepo returns a Repo backed by the given database.
func NewRepo(db *sql.DB) Repo {
	return &sqlRepo{db: db}
}

// StandingsOf reads one row per bound team. Ranking happens in Go so the tie
// rules live in one tested place rather than in an ORDER BY.
func (r *sqlRepo) StandingsOf(ctx context.Context, eventID string) ([]Standing, error) {
	const query = `
		SELECT v.code, v.team_name, s.total_score, s.finished_at
		FROM team_session s
		JOIN vehicle v ON v.id = s.vehicle_id
		WHERE s.event_id = ?`

	rows, err := r.db.QueryContext(ctx, query, eventID)
	if err != nil {
		return nil, fmt.Errorf("select standings: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var standings []Standing
	for rows.Next() {
		var (
			standing   Standing
			finishedAt sql.NullTime
		)
		if err := rows.Scan(&standing.VehicleCode, &standing.TeamName, &standing.TotalScore, &finishedAt); err != nil {
			return nil, fmt.Errorf("scan standing: %w", err)
		}
		if finishedAt.Valid {
			at := finishedAt.Time
			standing.FinishTime = &at
		}
		standings = append(standings, standing)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate standings: %w", err)
	}

	return standings, nil
}

// ProgressOf lists every vehicle in the event, whether or not a crew has bound
// to it, so the monitor shows the whole field from the moment it is provisioned.
//
// TotalTasks is the count on that vehicle's route, which differs between the
// two courses, and Done counts its completed submissions.
func (r *sqlRepo) ProgressOf(ctx context.Context, eventID string) ([]VehicleProgress, error) {
	const query = `
		SELECT
			v.code,
			v.team_name,
			v.status,
			COALESCE(s.status, ''),
			COALESCE(s.total_score, 0),
			s.last_lat,
			s.last_lng,
			s.last_ping_at,
			(
				SELECT MAX(d.last_seen_at)
				FROM session_device d
				WHERE d.session_id = s.id
			) AS last_report_at,
			(
				SELECT COUNT(*)
				FROM waypoint w
				JOIN waypoint_task wt ON wt.waypoint_id = w.id
				WHERE w.route_id = v.route_id
			) AS total_tasks,
			(
				SELECT COUNT(*)
				FROM task_submission ts
				WHERE ts.session_id = s.id AND ts.status = 'completed'
			) AS done
		FROM vehicle v
		LEFT JOIN team_session s
			ON s.vehicle_id = v.id AND s.status IN ('bound', 'active', 'finished')
		WHERE v.event_id = ?
		ORDER BY v.code`

	rows, err := r.db.QueryContext(ctx, query, eventID)
	if err != nil {
		return nil, fmt.Errorf("select vehicle progress: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var progress []VehicleProgress
	for rows.Next() {
		var (
			row          VehicleProgress
			lastSeenAt   sql.NullTime
			lastReportAt sql.NullTime
		)
		if err := rows.Scan(&row.VehicleCode, &row.TeamName, &row.Status, &row.SessionStatus,
			&row.TotalScore, &row.LastLat, &row.LastLng, &lastSeenAt, &lastReportAt,
			&row.TotalTasks, &row.Done); err != nil {
			return nil, fmt.Errorf("scan vehicle progress: %w", err)
		}
		if lastSeenAt.Valid {
			at := lastSeenAt.Time
			row.LastSeenAt = &at
		}
		if lastReportAt.Valid {
			at := lastReportAt.Time
			row.LastReportAt = &at
		}
		progress = append(progress, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate vehicle progress: %w", err)
	}

	return progress, nil
}

func (r *sqlRepo) OpenAlertCountOf(ctx context.Context, eventID string) (int, error) {
	const query = `
		SELECT COUNT(*)
		FROM vehicle_alert a
		JOIN vehicle v ON v.id = a.vehicle_id
		WHERE v.event_id = ? AND a.resolved_at IS NULL`

	var count int
	if err := r.db.QueryRowContext(ctx, query, eventID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count open alerts: %w", err)
	}

	return count, nil
}
