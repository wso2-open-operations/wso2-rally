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

package vehicles

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
)

const vehicleColumns = "id, event_id, code, team_name, vehicle_type, contact_number, route_id, status"

const insertVehicleQuery = "INSERT INTO vehicle (" + vehicleColumns + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)"

const crewColumns = "id, vehicle_id, name, email, phone_number, role, origin_country"

const insertCrewQuery = "INSERT INTO crew_member (" + crewColumns + ") VALUES (?, ?, ?, ?, ?, ?, ?)"

type sqlRepo struct {
	db *sql.DB
}

// NewRepo returns a Repo backed by the given database.
func NewRepo(db *sql.DB) Repo {
	return &sqlRepo{db: db}
}

func (r *sqlRepo) Create(ctx context.Context, v Vehicle) error {
	return r.CreateMany(ctx, []Vehicle{v})
}

// CreateMany inserts vehicles and their crews in a single transaction, so a
// failed CSV import leaves nothing behind.
func (r *sqlRepo) CreateMany(ctx context.Context, list []Vehicle) error {
	if len(list) == 0 {
		return nil
	}

	err := store.InTx(ctx, r.db, func(tx *sql.Tx) error {
		vehicleStmt, err := tx.PrepareContext(ctx, insertVehicleQuery)
		if err != nil {
			return fmt.Errorf("prepare vehicle insert: %w", err)
		}
		defer func() { _ = vehicleStmt.Close() }()

		crewStmt, err := tx.PrepareContext(ctx, insertCrewQuery)
		if err != nil {
			return fmt.Errorf("prepare crew insert: %w", err)
		}
		defer func() { _ = crewStmt.Close() }()

		for _, v := range list {
			_, err := vehicleStmt.ExecContext(ctx,
				v.ID, v.EventID, v.Code, v.TeamName,
				nullString(v.VehicleType), nullString(v.ContactNumber), nullString(v.RouteID), string(v.Status))
			if err != nil {
				return fmt.Errorf("insert vehicle %s: %w", v.Code, err)
			}
			for _, member := range v.Crew {
				_, err := crewStmt.ExecContext(ctx, member.ID, v.ID, member.Name, member.Email,
					member.PhoneNumber, string(member.Role), nullString(member.OriginCountry))
				if err != nil {
					return fmt.Errorf("insert crew member of vehicle %s: %w", v.Code, err)
				}
			}
		}

		return nil
	})
	if store.IsDuplicateKey(err) {
		return ErrDuplicateCode
	}

	return err
}

func (r *sqlRepo) Get(ctx context.Context, id string) (Vehicle, error) {
	const query = "SELECT " + vehicleColumns + " FROM vehicle WHERE id = ?"

	vehicle, err := scanVehicle(r.db.QueryRowContext(ctx, query, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Vehicle{}, ErrNotFound
	}
	if err != nil {
		return Vehicle{}, fmt.Errorf("select vehicle %s: %w", id, err)
	}

	crew, err := r.crewOf(ctx, id)
	if err != nil {
		return Vehicle{}, err
	}
	vehicle.Crew = crew

	return vehicle, nil
}

// Update rewrites the vehicle row and replaces its crew, both in one
// transaction so the vehicle is never briefly crewless.
func (r *sqlRepo) Update(ctx context.Context, v Vehicle) error {
	const updateQuery = `
		UPDATE vehicle SET code = ?, team_name = ?, vehicle_type = ?, contact_number = ?, route_id = ?, status = ?
		WHERE id = ?`

	err := store.InTx(ctx, r.db, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, updateQuery,
			v.Code, v.TeamName, nullString(v.VehicleType), nullString(v.ContactNumber),
			nullString(v.RouteID), string(v.Status), v.ID)
		if err != nil {
			return fmt.Errorf("update vehicle %s: %w", v.ID, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("update vehicle %s: %w", v.ID, err)
		}
		if affected == 0 {
			var exists int
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM vehicle WHERE id = ?", v.ID).Scan(&exists); err != nil {
				return fmt.Errorf("verify vehicle %s: %w", v.ID, err)
			}
			if exists == 0 {
				return ErrNotFound
			}
		}

		if _, err := tx.ExecContext(ctx, "DELETE FROM crew_member WHERE vehicle_id = ?", v.ID); err != nil {
			return fmt.Errorf("clear crew of vehicle %s: %w", v.ID, err)
		}
		if len(v.Crew) == 0 {
			return nil
		}

		crewStmt, err := tx.PrepareContext(ctx, insertCrewQuery)
		if err != nil {
			return fmt.Errorf("prepare crew insert: %w", err)
		}
		defer func() { _ = crewStmt.Close() }()

		for _, member := range v.Crew {
			_, err := crewStmt.ExecContext(ctx, member.ID, v.ID, member.Name, member.Email,
				member.PhoneNumber, string(member.Role), nullString(member.OriginCountry))
			if err != nil {
				return fmt.Errorf("insert crew member of vehicle %s: %w", v.ID, err)
			}
		}

		return nil
	})
	if store.IsDuplicateKey(err) {
		return ErrDuplicateCode
	}

	return err
}

func (r *sqlRepo) Search(
	ctx context.Context, eventID string, filter SearchFilter, page httpx.Page,
) ([]Vehicle, int, error) {
	where, args := searchWhere(eventID, filter)

	var total int
	if err := r.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM vehicle"+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count vehicles: %w", err)
	}
	if total == 0 {
		return nil, 0, nil
	}

	query := "SELECT " + vehicleColumns + " FROM vehicle" + where + " ORDER BY code LIMIT ? OFFSET ?"
	found, err := r.queryVehicles(ctx, query, append(args, page.Limit, page.Offset)...)
	if err != nil {
		return nil, 0, err
	}

	return found, total, nil
}

// searchWhere builds the shared predicate for the count and the page, so the
// two can never drift and report a total the rows do not match.
func searchWhere(eventID string, filter SearchFilter) (string, []any) {
	where := " WHERE event_id = ?"
	args := []any{eventID}

	if filter.Query != "" {
		// LIKE, not full-text: the fleet is ~150 rows, and an organizer types a
		// fragment ("087", "Dashers") rather than a whole word.
		like := "%" + escapeLike(filter.Query) + "%"
		where += " AND (code LIKE ? OR team_name LIKE ?)"
		args = append(args, like, like)
	}
	if filter.RouteID != "" {
		where += " AND route_id = ?"
		args = append(args, filter.RouteID)
	}

	return where, args
}

// escapeLike neutralises the wildcards, so a code containing "%" or "_"
// searches for itself rather than matching the fleet.
func escapeLike(s string) string {
	replacer := strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`)

	return replacer.Replace(s)
}

func (r *sqlRepo) Delete(ctx context.Context, id string) error {
	// Crew, sessions and alerts cascade away with the row, so the guard against
	// deleting a vehicle that has run has to hold at the moment of the delete —
	// not a statement earlier. Service.Delete checks HasRun first for a helpful
	// error, but a session created between that check and this statement would
	// otherwise be destroyed along with its alerts and submissions. The join
	// makes the check and the delete one statement, so there is no window.
	const query = `
		DELETE v FROM vehicle v
		LEFT JOIN team_session s ON s.vehicle_id = v.id
		WHERE v.id = ? AND s.id IS NULL`

	result, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("delete vehicle %s: %w", id, err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read affected rows: %w", err)
	}
	if affected == 0 {
		// Nothing was deleted: either the vehicle is gone, or it gained a
		// session since the service checked. Say which.
		hasRun, runErr := r.HasRun(ctx, id)
		if runErr != nil {
			return runErr
		}
		if hasRun {
			return ErrHasRun
		}

		return ErrNotFound
	}

	return nil
}

func (r *sqlRepo) HasRun(ctx context.Context, vehicleID string) (bool, error) {
	var exists int
	err := r.db.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM team_session WHERE vehicle_id = ?)", vehicleID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("count sessions of vehicle %s: %w", vehicleID, err)
	}

	return exists == 1, nil
}

func (r *sqlRepo) ListByEvent(ctx context.Context, eventID string) ([]Vehicle, error) {
	const query = "SELECT " + vehicleColumns + " FROM vehicle WHERE event_id = ? ORDER BY code"

	return r.queryVehicles(ctx, query, eventID)
}

// queryVehicles runs a vehicle projection and attaches each row's crew in one
// further query, keeping the cost flat rather than one query per vehicle.
func (r *sqlRepo) queryVehicles(ctx context.Context, query string, args ...any) ([]Vehicle, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("select vehicles: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var (
		found []Vehicle
		byID  = map[string]int{}
	)
	for rows.Next() {
		vehicle, err := scanVehicle(rows)
		if err != nil {
			return nil, fmt.Errorf("scan vehicle: %w", err)
		}
		byID[vehicle.ID] = len(found)
		found = append(found, vehicle)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate vehicles: %w", err)
	}
	if len(found) == 0 {
		return nil, nil
	}

	if err := r.attachCrew(ctx, found, byID); err != nil {
		return nil, err
	}

	return found, nil
}

func (r *sqlRepo) attachCrew(ctx context.Context, list []Vehicle, byID map[string]int) error {
	ids := make([]any, 0, len(list))
	for _, v := range list {
		ids = append(ids, v.ID)
	}

	query := "SELECT " + crewColumns + " FROM crew_member WHERE vehicle_id IN (" +
		placeholders(len(ids)) + ") ORDER BY vehicle_id, name"
	rows, err := r.db.QueryContext(ctx, query, ids...)
	if err != nil {
		return fmt.Errorf("select crew: %w", err)
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		member, err := scanCrewMember(rows)
		if err != nil {
			return fmt.Errorf("scan crew member: %w", err)
		}
		if idx, ok := byID[member.VehicleID]; ok {
			list[idx].Crew = append(list[idx].Crew, member)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate crew: %w", err)
	}

	return nil
}

func (r *sqlRepo) crewOf(ctx context.Context, vehicleID string) ([]CrewMember, error) {
	const query = "SELECT " + crewColumns + " FROM crew_member WHERE vehicle_id = ? ORDER BY name"

	rows, err := r.db.QueryContext(ctx, query, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("select crew of vehicle %s: %w", vehicleID, err)
	}
	defer func() { _ = rows.Close() }()

	var crew []CrewMember
	for rows.Next() {
		member, err := scanCrewMember(rows)
		if err != nil {
			return nil, fmt.Errorf("scan crew member: %w", err)
		}
		crew = append(crew, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate crew: %w", err)
	}

	return crew, nil
}

func (r *sqlRepo) SetStatus(ctx context.Context, vehicleID string, status Status) error {
	result, err := r.db.ExecContext(ctx, "UPDATE vehicle SET status = ? WHERE id = ?", string(status), vehicleID)
	if err != nil {
		return fmt.Errorf("update status of vehicle %s: %w", vehicleID, err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update status of vehicle %s: %w", vehicleID, err)
	}
	if affected == 0 {
		// Re-reading distinguishes "already this status" from "no such vehicle".
		if _, getErr := r.Get(ctx, vehicleID); getErr != nil {
			return getErr
		}
	}

	return nil
}

func (r *sqlRepo) RouteNamesByID(ctx context.Context, eventID string) (map[string]string, error) {
	return r.routeMapping(ctx, eventID, false)
}

func (r *sqlRepo) RouteIDsByName(ctx context.Context, eventID string) (map[string]string, error) {
	return r.routeMapping(ctx, eventID, true)
}

func (r *sqlRepo) routeMapping(ctx context.Context, eventID string, byName bool) (map[string]string, error) {
	rows, err := r.db.QueryContext(ctx, "SELECT id, name FROM route WHERE event_id = ?", eventID)
	if err != nil {
		return nil, fmt.Errorf("select routes of event %s: %w", eventID, err)
	}
	defer func() { _ = rows.Close() }()

	mapping := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("scan route: %w", err)
		}
		if byName {
			mapping[name] = id
		} else {
			mapping[id] = name
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate routes: %w", err)
	}

	return mapping, nil
}

// rowScanner is satisfied by both *sql.Row and *sql.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanVehicle(row rowScanner) (Vehicle, error) {
	var (
		v                                   Vehicle
		status                              string
		vehicleType, contactNumber, routeID sql.NullString
	)
	if err := row.Scan(&v.ID, &v.EventID, &v.Code, &v.TeamName,
		&vehicleType, &contactNumber, &routeID, &status); err != nil {
		return Vehicle{}, err
	}

	v.VehicleType = vehicleType.String
	v.ContactNumber = contactNumber.String
	v.RouteID = routeID.String
	v.Status = Status(status)

	return v, nil
}

func scanCrewMember(row rowScanner) (CrewMember, error) {
	var (
		member        CrewMember
		role          string
		originCountry sql.NullString
	)
	if err := row.Scan(&member.ID, &member.VehicleID, &member.Name, &member.Email, &member.PhoneNumber,
		&role, &originCountry); err != nil {
		return CrewMember{}, err
	}

	member.Role = CrewRole(role)
	member.OriginCountry = originCountry.String

	return member, nil
}

// placeholders builds "?, ?, ?" for an IN clause of n values.
func placeholders(n int) string {
	if n <= 0 {
		return ""
	}

	out := make([]byte, 0, n*3)
	for i := range n {
		if i > 0 {
			out = append(out, ',', ' ')
		}
		out = append(out, '?')
	}

	return string(out)
}

// nullString stores an empty optional string as SQL NULL rather than "".
func nullString(s string) any {
	if s == "" {
		return nil
	}

	return s
}
