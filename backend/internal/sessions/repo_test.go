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
