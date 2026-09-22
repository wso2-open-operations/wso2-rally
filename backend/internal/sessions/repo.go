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

package sessions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/tasks"
)

const sessionColumns = `
	id, event_id, vehicle_id, status, current_waypoint_id, total_score,
	bound_at, started_at, finished_at, last_lat, last_lng, last_ping_at`

type sqlRepo struct {
	db *sql.DB
}

// NewRepo returns a Repo backed by the given database.
func NewRepo(db *sql.DB) Repo {
	return &sqlRepo{db: db}
}

func (r *sqlRepo) JoinTargetOf(ctx context.Context, vehicleID string) (JoinTarget, error) {
	const query = "SELECT event_id, COALESCE(route_id, ''), code, team_name FROM vehicle WHERE id = ?"

	var target JoinTarget
	err := r.db.QueryRowContext(ctx, query, vehicleID).
		Scan(&target.EventID, &target.RouteID, &target.Code, &target.TeamName)
	if errors.Is(err, sql.ErrNoRows) {
		return JoinTarget{}, ErrVehicleNotFound
	}
	if err != nil {
		return JoinTarget{}, fmt.Errorf("select vehicle %s: %w", vehicleID, err)
	}

	crew, err := r.crewRosterOf(ctx, vehicleID)
	if err != nil {
		return JoinTarget{}, err
	}
	target.Crew = crew

	return target, nil
}

func (r *sqlRepo) crewRosterOf(ctx context.Context, vehicleID string) ([]CrewRosterMember, error) {
	const query = `
		SELECT id, name, email, phone_number, role
		FROM crew_member WHERE vehicle_id = ? ORDER BY name`

	rows, err := r.db.QueryContext(ctx, query, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("select crew of vehicle %s: %w", vehicleID, err)
	}
	defer func() { _ = rows.Close() }()

	var roster []CrewRosterMember
	for rows.Next() {
		var member CrewRosterMember
		if err := rows.Scan(&member.ID, &member.Name, &member.Email, &member.PhoneNumber, &member.Role); err != nil {
			return nil, fmt.Errorf("scan crew member: %w", err)
		}
		roster = append(roster, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate crew: %w", err)
	}

	return roster, nil
}

// CreateSession relies on the uq_live_session_per_vehicle index so that phones
// racing to start their car's run converge on one session rather than creating
// several. The loser reads the winner's session back.
func (r *sqlRepo) CreateSession(ctx context.Context, s Session) error {
	const query = `
		INSERT INTO team_session (id, event_id, vehicle_id, status, bound_at, total_score)
		VALUES (?, ?, ?, ?, ?, ?)`

	_, err := r.db.ExecContext(ctx, query, s.ID, s.EventID, s.VehicleID, string(s.Status), s.BoundAt, s.TotalScore)
	if store.IsDuplicateKey(err) {
		return ErrAlreadyBound
	}
	if err != nil {
		return fmt.Errorf("insert session: %w", err)
	}

	return nil
}

// LiveSessionOf returns the vehicle's run under way, if there is one.
//
// The status filter matches uq_live_session_per_vehicle: a vehicle accumulates
// finished sessions across days, and only a live one is joinable.
func (r *sqlRepo) LiveSessionOf(ctx context.Context, vehicleID string) (Session, error) {
	query := "SELECT " + sessionColumns + `
		FROM team_session WHERE vehicle_id = ? AND status IN ('bound', 'active')`

	session, err := scanSession(r.db.QueryRowContext(ctx, query, vehicleID))
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrNoLiveSession
	}
	if err != nil {
		return Session{}, fmt.Errorf("select live session of vehicle %s: %w", vehicleID, err)
	}

	return session, nil
}

// deviceColumns is the shared select list, joined to crew_member so a phone can
// be labelled with its owner's name without a second round trip.
const deviceColumns = `
	d.id, d.session_id, d.crew_member_id, c.name, d.joined_at, d.last_seen_at`

// UpsertDevice puts a member's phone in the session, or returns the row it
// already had.
//
// Re-joining is not an error. A phone that rebooted, cleared its storage, or was
// swapped for a borrowed handset comes back through here, and the crew member —
// not the handset — is the identity, so it lands on the same row. That also
// means the old token keeps working; acceptable, because the tokens are
// short-lived and a car's phones are not adversaries.
func (r *sqlRepo) UpsertDevice(ctx context.Context, sessionID, crewMemberID string) (Device, error) {
	// ON DUPLICATE KEY UPDATE session_id = session_id is a deliberate no-op:
	// it makes a repeat join return zero affected rows instead of raising 1062,
	// while still surfacing a genuine foreign-key failure.
	const upsert = `
		INSERT INTO session_device (id, session_id, crew_member_id, joined_at)
		VALUES (?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE session_id = session_id`

	if _, err := r.db.ExecContext(ctx, upsert, store.NewID(), sessionID, crewMemberID, time.Now().UTC()); err != nil {
		return Device{}, fmt.Errorf("upsert device: %w", err)
	}

	query := "SELECT " + deviceColumns + `
		FROM session_device d
		JOIN crew_member c ON c.id = d.crew_member_id
		WHERE d.session_id = ? AND d.crew_member_id = ?`

	device, err := scanDevice(r.db.QueryRowContext(ctx, query, sessionID, crewMemberID))
	if err != nil {
		return Device{}, fmt.Errorf("read back device: %w", err)
	}

	return device, nil
}

func (r *sqlRepo) DevicesOf(ctx context.Context, sessionID string) ([]Device, error) {
	query := "SELECT " + deviceColumns + `
		FROM session_device d
		JOIN crew_member c ON c.id = d.crew_member_id
		WHERE d.session_id = ?
		ORDER BY d.joined_at, d.id`

	rows, err := r.db.QueryContext(ctx, query, sessionID)
	if err != nil {
		return nil, fmt.Errorf("select devices of session %s: %w", sessionID, err)
	}
	defer func() { _ = rows.Close() }()

	var devices []Device
	for rows.Next() {
		device, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		devices = append(devices, device)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate devices: %w", err)
	}

	return devices, nil
}

func (r *sqlRepo) DeviceOf(ctx context.Context, deviceID string) (Device, error) {
	query := "SELECT " + deviceColumns + `
		FROM session_device d
		JOIN crew_member c ON c.id = d.crew_member_id
		WHERE d.id = ?`

	device, err := scanDevice(r.db.QueryRowContext(ctx, query, deviceID))
	if errors.Is(err, sql.ErrNoRows) {
		return Device{}, ErrDeviceNotFound
	}
	if err != nil {
		return Device{}, fmt.Errorf("select device %s: %w", deviceID, err)
	}

	return device, nil
}

// TouchDevice records that a phone was heard from. This is the only writer of
// last_seen_at, and therefore the only thing that makes a phone count as
// sharing location.
func (r *sqlRepo) TouchDevice(ctx context.Context, deviceID string, at time.Time) error {
	const query = "UPDATE session_device SET last_seen_at = ? WHERE id = ?"

	if _, err := r.db.ExecContext(ctx, query, at, deviceID); err != nil {
		return fmt.Errorf("touch device %s: %w", deviceID, err)
	}

	return nil
}

func scanDevice(row rowScanner) (Device, error) {
	var (
		device   Device
		lastSeen sql.NullTime
	)
	if err := row.Scan(&device.ID, &device.SessionID, &device.CrewMemberID,
		&device.CrewMemberName, &device.JoinedAt, &lastSeen); err != nil {
		return Device{}, err
	}
	device.LastSeenAt = timePtr(lastSeen)

	return device, nil
}

func (r *sqlRepo) GetSession(ctx context.Context, id string) (Session, error) {
	query := "SELECT " + sessionColumns + " FROM team_session WHERE id = ?"

	session, err := scanSession(r.db.QueryRowContext(ctx, query, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, fmt.Errorf("select session %s: %w", id, err)
	}

	return session, nil
}

func (r *sqlRepo) UpdateSession(ctx context.Context, s Session) error {
	const query = `
		UPDATE team_session SET
			status = ?, current_waypoint_id = ?, total_score = ?,
			started_at = ?, finished_at = ?, last_lat = ?, last_lng = ?, last_ping_at = ?
		WHERE id = ?`

	result, err := r.db.ExecContext(ctx, query,
		string(s.Status), s.CurrentWaypointID, s.TotalScore,
		s.StartedAt, s.FinishedAt, s.LastLat, s.LastLng, s.LastPingAt, s.ID)
	if err != nil {
		return fmt.Errorf("update session %s: %w", s.ID, err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update session %s: %w", s.ID, err)
	}
	if affected == 0 {
		if _, getErr := r.GetSession(ctx, s.ID); getErr != nil {
			return getErr
		}
	}

	return nil
}

func (r *sqlRepo) EventInfoOf(ctx context.Context, eventID string) (EventInfo, error) {
	const query = `
		SELECT status, COALESCE(cipher, ''), start_time,
		       start_lat, start_lng, start_radius_m,
		       end_lat, end_lng, end_radius_m
		FROM event WHERE id = ?`

	var (
		info                     EventInfo
		startLat, startLng       sql.NullFloat64
		endLat, endLng           sql.NullFloat64
		startRadiusM, endRadiusM int
	)
	err := r.db.QueryRowContext(ctx, query, eventID).Scan(
		&info.Status, &info.Cipher, &info.StartTime,
		&startLat, &startLng, &startRadiusM,
		&endLat, &endLng, &endRadiusM,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return EventInfo{}, fmt.Errorf("%w: event %s", ErrNotFound, eventID)
	}
	if err != nil {
		return EventInfo{}, fmt.Errorf("select event %s: %w", eventID, err)
	}

	info.Start = circleFrom(startLat, startLng, startRadiusM)
	info.Finish = circleFrom(endLat, endLng, endRadiusM)

	return info, nil
}

// WaypointsOf loads a route's boundaries together with the tasks attached to
// each, which is everything EvaluatePing needs.
func (r *sqlRepo) WaypointsOf(ctx context.Context, routeID string) ([]WaypointGeo, error) {
	const query = `
		SELECT w.id, w.display_order, w.lat, w.lng, w.boundary_radius_m,
		       COALESCE(t.id, ''), COALESCE(t.type, '')
		FROM waypoint w
		LEFT JOIN waypoint_task wt ON wt.waypoint_id = w.id
		LEFT JOIN task t ON t.id = wt.task_id
		WHERE w.route_id = ?
		ORDER BY w.display_order, wt.display_order`

	rows, err := r.db.QueryContext(ctx, query, routeID)
	if err != nil {
		return nil, fmt.Errorf("select waypoints of route %s: %w", routeID, err)
	}
	defer func() { _ = rows.Close() }()

	var (
		waypoints []WaypointGeo
		byID      = map[string]int{}
	)
	for rows.Next() {
		var (
			id            string
			order         int
			lat, lng      float64
			radiusM       int
			taskID, tType string
		)
		if err := rows.Scan(&id, &order, &lat, &lng, &radiusM, &taskID, &tType); err != nil {
			return nil, fmt.Errorf("scan waypoint: %w", err)
		}

		idx, seen := byID[id]
		if !seen {
			idx = len(waypoints)
			byID[id] = idx
			waypoints = append(waypoints, WaypointGeo{
				ID:     id,
				Order:  order,
				Circle: GeoCircle{Lat: lat, Lng: lng, RadiusM: radiusM, Placed: true},
			})
		}
		// The left join yields one row per attached task, and a single row with
		// an empty task id when the waypoint has none.
		if taskID != "" {
			waypoints[idx].Tasks = append(waypoints[idx].Tasks,
				WaypointTask{ID: taskID, Type: tasks.TaskType(tType)})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate waypoints: %w", err)
	}

	return waypoints, nil
}

func (r *sqlRepo) RouteIDOfVehicle(ctx context.Context, vehicleID string) (string, error) {
	var routeID string
	err := r.db.QueryRowContext(ctx,
		"SELECT COALESCE(route_id, '') FROM vehicle WHERE id = ?", vehicleID).Scan(&routeID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrVehicleNotFound
	}
	if err != nil {
		return "", fmt.Errorf("select route of vehicle %s: %w", vehicleID, err)
	}

	return routeID, nil
}

// TaskStatesOf lists every task on the crew's route, left-joined onto their own
// submissions so an unattempted task still appears.
func (r *sqlRepo) TaskStatesOf(ctx context.Context, sessionID, routeID string) ([]TaskState, error) {
	const query = `
		SELECT t.id, w.id, t.code, t.title, t.type, t.points,
		       COALESCE(s.status, 'pending'), COALESCE(s.awarded_points, 0),
		       COALESCE(c.name, '')
		FROM waypoint w
		JOIN waypoint_task wt ON wt.waypoint_id = w.id
		JOIN task t ON t.id = wt.task_id
		LEFT JOIN task_submission s ON s.task_id = t.id AND s.session_id = ?
		LEFT JOIN crew_member c ON c.id = s.crew_member_id
		WHERE w.route_id = ?
		ORDER BY w.display_order, wt.display_order`

	rows, err := r.db.QueryContext(ctx, query, sessionID, routeID)
	if err != nil {
		return nil, fmt.Errorf("select task states: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var states []TaskState
	for rows.Next() {
		var state TaskState
		if err := rows.Scan(&state.TaskID, &state.WaypointID, &state.Code, &state.Title,
			&state.Type, &state.Points, &state.Status, &state.Awarded,
			&state.CompletedBy); err != nil {
			return nil, fmt.Errorf("scan task state: %w", err)
		}
		states = append(states, state)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate task states: %w", err)
	}

	return states, nil
}

func (r *sqlRepo) CreateVoucher(ctx context.Context, v Voucher) error {
	const query = `
		INSERT INTO voucher (id, session_id, entry_code, locker_id, lunch_passes)
		VALUES (?, ?, ?, ?, ?)`

	_, err := r.db.ExecContext(ctx, query, v.ID, v.SessionID, v.EntryCode, v.LockerID, v.LunchPasses)
	if store.IsDuplicateKey(err) {
		return nil // The crew already has a voucher; issuing is idempotent.
	}
	if err != nil {
		return fmt.Errorf("insert voucher: %w", err)
	}

	return nil
}

func (r *sqlRepo) VoucherOf(ctx context.Context, sessionID string) (Voucher, error) {
	const query = `
		SELECT id, session_id, COALESCE(entry_code, ''), COALESCE(locker_id, ''), lunch_passes
		FROM voucher WHERE session_id = ?`

	var v Voucher
	err := r.db.QueryRowContext(ctx, query, sessionID).
		Scan(&v.ID, &v.SessionID, &v.EntryCode, &v.LockerID, &v.LunchPasses)
	if errors.Is(err, sql.ErrNoRows) {
		return Voucher{}, ErrNoVoucher
	}
	if err != nil {
		return Voucher{}, fmt.Errorf("select voucher of session %s: %w", sessionID, err)
	}

	return v, nil
}

func (r *sqlRepo) CrewSizeOf(ctx context.Context, vehicleID string) (int, error) {
	var size int
	if err := r.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM crew_member WHERE vehicle_id = ?", vehicleID).Scan(&size); err != nil {
		return 0, fmt.Errorf("count crew of vehicle %s: %w", vehicleID, err)
	}

	return size, nil
}

func (r *sqlRepo) VehicleCodeOf(ctx context.Context, vehicleID string) (string, error) {
	var code string
	err := r.db.QueryRowContext(ctx, "SELECT code FROM vehicle WHERE id = ?", vehicleID).Scan(&code)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrVehicleNotFound
	}
	if err != nil {
		return "", fmt.Errorf("select code of vehicle %s: %w", vehicleID, err)
	}

	return code, nil
}

func (r *sqlRepo) SubmittableTaskOf(ctx context.Context, taskID string) (SubmittableTask, error) {
	const query = "SELECT id, event_id, code, type, points, config FROM task WHERE id = ?"

	var (
		task     SubmittableTask
		taskType string
		config   []byte
	)
	err := r.db.QueryRowContext(ctx, query, taskID).
		Scan(&task.ID, &task.EventID, &task.Code, &taskType, &task.Points, &config)
	if errors.Is(err, sql.ErrNoRows) {
		return SubmittableTask{}, ErrTaskNotOnThisRally
	}
	if err != nil {
		return SubmittableTask{}, fmt.Errorf("select task %s: %w", taskID, err)
	}

	task.Type = tasks.TaskType(taskType)
	task.Config = config

	return task, nil
}

// ClaimWaypointVisits records the boundaries the car has just entered and
// returns only those it had never entered before.
//
// The insert is the edge detector: a row per (session, waypoint) exists once the
// car has been inside, so a repeat ping while parked in the circle claims
// nothing. ON DUPLICATE KEY UPDATE rather than INSERT IGNORE, because IGNORE
// also downgrades a foreign-key violation to a warning and reports zero rows —
// which would read as "already visited" and quietly lose a real unlock.
func (r *sqlRepo) ClaimWaypointVisits(
	ctx context.Context, sessionID string, waypointIDs []string,
) ([]string, error) {
	if len(waypointIDs) == 0 {
		return nil, nil
	}

	const claim = `
		INSERT INTO session_waypoint_visit (session_id, waypoint_id)
		VALUES (?, ?)
		ON DUPLICATE KEY UPDATE session_id = session_id`

	// One statement per waypoint: a ping is inside a handful of circles at most,
	// and a per-row result is exactly what tells us which crossing is new.
	var fresh []string
	for _, waypointID := range waypointIDs {
		result, err := r.db.ExecContext(ctx, claim, sessionID, waypointID)
		if err != nil {
			return nil, fmt.Errorf("claim visit of waypoint %s: %w", waypointID, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, fmt.Errorf("claim visit of waypoint %s: %w", waypointID, err)
		}
		if affected == 1 {
			fresh = append(fresh, waypointID)
		}
	}

	return fresh, nil
}

// submissionRaceIndex is the unique index that decides which of a car's phones
// won a task. Named here because losing on *this* index means "a teammate got
// there first", while a duplicate on any other means something is wrong.
const submissionRaceIndex = "uq_submission_session_task"

// SaveSubmission claims the task for this car, or reports who already has it.
//
// The insert is the race: four phones may be answering the same question, and
// the unique index lets exactly one of them through. The row is never updated
// afterwards, so the total recomputed from the stored attempts is monotonic and
// the published delta is a real delta.
//
// Insert-and-catch rather than ON DUPLICATE KEY UPDATE with RowsAffected. The
// RowsAffected trick works — 1 for an insert, 0 for a no-op — but only while the
// connection leaves CLIENT_FOUND_ROWS off, so one DSN parameter added by someone
// chasing an unrelated puzzle would silently turn "a teammate already won" into
// "I won" and double-score the car. A scoring rule should not rest on that.
func (r *sqlRepo) SaveSubmission(ctx context.Context, sub Submission) (int, error) {
	const claim = `
		INSERT INTO task_submission
			(id, session_id, task_id, crew_member_id, waypoint_id, status,
			 payload, awarded_points, submitted_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

	const recompute = `
		UPDATE team_session
		SET total_score = (SELECT COALESCE(SUM(awarded_points), 0) FROM task_submission WHERE session_id = ?)
		WHERE id = ?`

	var total int
	err := store.InTx(ctx, r.db, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, claim,
			sub.ID, sub.SessionID, sub.TaskID, nullString(sub.CrewMemberID), sub.WaypointID,
			sub.Status, []byte(sub.Payload), sub.AwardedPoints, sub.SubmittedAt)
		if err != nil {
			return fmt.Errorf("claim task %s: %w", sub.TaskID, err)
		}

		if _, err := tx.ExecContext(ctx, recompute, sub.SessionID, sub.SessionID); err != nil {
			return fmt.Errorf("recompute session score: %w", err)
		}

		return tx.QueryRowContext(ctx,
			"SELECT total_score FROM team_session WHERE id = ?", sub.SessionID).Scan(&total)
	})

	if store.IsDuplicateKeyOn(err, submissionRaceIndex) {
		// Read the winner after the rollback, on a fresh snapshot, so there is
		// no question of seeing our own aborted write instead of theirs.
		winner, lookupErr := r.winnerOf(ctx, sub.SessionID, sub.TaskID)
		if lookupErr != nil {
			// No row means the collision was not the race after all — a
			// NewID() primary-key clash, say. Never invent a winner for it.
			return 0, errors.Join(err, lookupErr)
		}

		return 0, ErrTaskClaimedBy(winner)
	}
	if err != nil {
		return 0, err
	}

	return total, nil
}

// nullString writes "" as NULL, so an unattributed submission leaves the
// foreign key empty rather than pointing at a crew member id of "".
func nullString(s string) any {
	if s == "" {
		return nil
	}

	return s
}

func (r *sqlRepo) winnerOf(ctx context.Context, sessionID, taskID string) (TaskWinner, error) {
	const query = `
		SELECT COALESCE(s.crew_member_id, ''), COALESCE(c.name, ''), s.awarded_points
		FROM task_submission s
		LEFT JOIN crew_member c ON c.id = s.crew_member_id
		WHERE s.session_id = ? AND s.task_id = ?`

	var winner TaskWinner
	err := r.db.QueryRowContext(ctx, query, sessionID, taskID).
		Scan(&winner.CrewMemberID, &winner.CrewMemberName, &winner.AwardedPoints)
	if err != nil {
		return TaskWinner{}, fmt.Errorf("read the winner of task %s: %w", taskID, err)
	}

	return winner, nil
}

// rowScanner is satisfied by both *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanSession(row rowScanner) (Session, error) {
	var (
		s                 Session
		status            string
		currentWaypointID sql.NullString
		boundAt           sql.NullTime
		startedAt         sql.NullTime
		finishedAt        sql.NullTime
		lastPingAt        sql.NullTime
	)
	err := row.Scan(&s.ID, &s.EventID, &s.VehicleID, &status, &currentWaypointID, &s.TotalScore,
		&boundAt, &startedAt, &finishedAt, &s.LastLat, &s.LastLng, &lastPingAt)
	if err != nil {
		return Session{}, err
	}

	s.Status = Status(status)
	if currentWaypointID.Valid {
		id := currentWaypointID.String
		s.CurrentWaypointID = &id
	}
	s.BoundAt = timePtr(boundAt)
	s.StartedAt = timePtr(startedAt)
	s.FinishedAt = timePtr(finishedAt)
	s.LastPingAt = timePtr(lastPingAt)

	return s, nil
}

func timePtr(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	value := t.Time

	return &value
}

// circleFrom builds a boundary, marking it unplaced when the organizer has not
// dropped the pin, so it can never match a position.
func circleFrom(lat, lng sql.NullFloat64, radiusM int) GeoCircle {
	if !lat.Valid || !lng.Valid {
		return GeoCircle{RadiusM: radiusM}
	}

	return GeoCircle{Lat: lat.Float64, Lng: lng.Float64, RadiusM: radiusM, Placed: true}
}
