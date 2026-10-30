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
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/storetest"
)

// seedBoundSession inserts the event and vehicle rows a session's foreign keys
// need, then a session bound to them.
func seedBoundSession(t *testing.T, db *sql.DB) (Repo, Session) {
	t.Helper()

	eventID, vehicleID := store.NewID(), store.NewID()
	_, err := db.Exec(
		"INSERT INTO event (id, name, event_date, start_time, created_by) "+
			"VALUES (?, 'Rally', '2027-02-13', '09:00', 'organizer@wso2.com')", eventID)
	require.NoError(t, err)
	_, err = db.Exec(
		"INSERT INTO vehicle (id, event_id, code, team_name) VALUES (?, ?, 'PKT-001', 'Packets')",
		vehicleID, eventID)
	require.NoError(t, err)

	repo := NewRepo(db)
	boundAt := time.Now().UTC()
	session := Session{
		ID:        store.NewID(),
		EventID:   eventID,
		VehicleID: vehicleID,
		Status:    StatusBound,
		BoundAt:   &boundAt,
	}
	require.NoError(t, repo.CreateSession(context.Background(), session))

	return repo, session
}

// The anti-teleport guard divides distance since the last fix by time since it,
// so a last_ping_at that loses its fractional part is not a cosmetic problem: a
// bare TIMESTAMP rounds, and a stamp rounded *up* lands in the future, making
// the elapsed time negative — which the guard reads as a backwards clock and
// waves every jump through.
func TestRepo_SessionTimestamps_KeepSubSecondPrecision(t *testing.T) {
	db := storetest.DB(t)
	repo, session := seedBoundSession(t, db)
	ctx := context.Background()

	// .6 of a second: rounds *up* to the next whole second, so a column without
	// fractional seconds reads back 400 ms in the future.
	pingedAt := time.Date(2027, 2, 13, 9, 30, 10, 600_000_000, time.UTC)
	finishedAt := time.Date(2027, 2, 13, 14, 5, 30, 750_000_000, time.UTC)
	lat, lng := 6.8901, 79.92

	session.Status = StatusFinished
	session.LastLat, session.LastLng = &lat, &lng
	session.LastPingAt, session.FinishedAt = &pingedAt, &finishedAt
	require.NoError(t, repo.UpdateSession(ctx, session))

	got, err := repo.GetSession(ctx, session.ID)

	require.NoError(t, err)
	require.NotNil(t, got.LastPingAt)
	require.True(t, pingedAt.Equal(*got.LastPingAt),
		"last_ping_at must survive the round trip to the millisecond, got %s", got.LastPingAt)
	require.NotNil(t, got.FinishedAt)
	require.True(t, finishedAt.Equal(*got.FinishedAt),
		"finished_at breaks leaderboard ties, so it must not round, got %s", got.FinishedAt)
}

// The scheduler reads the rally day exactly as the organizer entered it. A
// driver-side time-zone conversion of a DATE would shift it to the previous day
// for any zone east of UTC — Colombo included — and fire a day early.
func TestRepo_ActiveEvents_ReadsTheDateAsEntered(t *testing.T) {
	db := storetest.DB(t)
	_, session := seedBoundSession(t, db)
	ctx := context.Background()
	_, err := db.Exec("UPDATE event SET status = 'active', cipher = 'API Integration' WHERE id = ?", session.EventID)
	require.NoError(t, err)

	events, err := NewRepo(db).ActiveEvents(ctx)

	require.NoError(t, err)
	require.Equal(t, []StartingEvent{{
		ID: session.EventID, Date: "2027-02-13", StartTime: "09:00", Cipher: "API Integration",
	}}, events)

	info, err := NewRepo(db).EventInfoOf(ctx, session.EventID)
	require.NoError(t, err)
	require.Equal(t, "2027-02-13", info.Date)
}

func TestRepo_ActiveEvents_SkipsEventsNotYetPublished(t *testing.T) {
	db := storetest.DB(t)
	seedBoundSession(t, db) // the seeded event stays in setup

	events, err := NewRepo(db).ActiveEvents(context.Background())

	require.NoError(t, err)
	require.Empty(t, events)
}

// A finished run has already crossed the line; a start signal is only for the
// cars still on the grid or on the course.
func TestRepo_LiveSessionIDsOf_OnlyBoundAndActive(t *testing.T) {
	db := storetest.DB(t)
	repo, session := seedBoundSession(t, db)
	ctx := context.Background()

	finished := Session{ID: store.NewID(), EventID: session.EventID, Status: StatusFinished}
	vehicleID := store.NewID()
	_, err := db.Exec(
		"INSERT INTO vehicle (id, event_id, code, team_name) VALUES (?, ?, 'PKT-002', 'Frames')",
		vehicleID, session.EventID)
	require.NoError(t, err)
	finished.VehicleID = vehicleID
	boundAt := time.Now().UTC()
	finished.BoundAt = &boundAt
	finished.Status = StatusBound
	require.NoError(t, repo.CreateSession(ctx, finished))
	finished.Status = StatusFinished
	require.NoError(t, repo.UpdateSession(ctx, finished))

	ids, err := repo.LiveSessionIDsOf(ctx, session.EventID)

	require.NoError(t, err)
	require.Equal(t, []string{session.ID}, ids)
}

// Coverage is the latest report from *any* phone in the car: the driver's has
// gone quiet in Google Maps, and the passenger's is what keeps it covered.
func TestRepo_ActiveSessionCoverage_TakesTheLatestPhone(t *testing.T) {
	db := storetest.DB(t)
	repo, session := seedBoundSession(t, db)
	ctx := context.Background()
	session.Status = StatusActive
	require.NoError(t, repo.UpdateSession(ctx, session))

	driverSeen := time.Date(2027, 2, 13, 9, 40, 0, 0, time.UTC)
	passengerSeen := time.Date(2027, 2, 13, 9, 45, 0, 0, time.UTC)
	for name, seen := range map[string]time.Time{"Driver": driverSeen, "Passenger": passengerSeen} {
		memberID := store.NewID()
		_, err := db.Exec(
			"INSERT INTO crew_member (id, vehicle_id, name, email, phone_number, role) "+
				"VALUES (?, ?, ?, ?, '+94 77 000 0000', 'node')",
			memberID, session.VehicleID, name, name+"@wso2.com")
		require.NoError(t, err)
		device, err := repo.UpsertDevice(ctx, session.ID, memberID)
		require.NoError(t, err)
		require.NoError(t, repo.TouchDevice(ctx, device.ID, seen))
	}

	cars, err := repo.ActiveSessionCoverage(ctx)

	require.NoError(t, err)
	require.Len(t, cars, 1)
	require.Equal(t, session.ID, cars[0].SessionID)
	require.Equal(t, "PKT-001", cars[0].VehicleCode)
	require.NotNil(t, cars[0].LastReportAt)
	require.True(t, passengerSeen.Equal(*cars[0].LastReportAt), "got %s", cars[0].LastReportAt)
}
