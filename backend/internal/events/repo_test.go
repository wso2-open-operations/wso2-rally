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
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/storetest"
)

func TestRepo_CreateGetRoundTrip(t *testing.T) {
	repo := NewRepo(storetest.DB(t))
	ctx := context.Background()
	want, err := NewService(repo).Create(ctx, validInput())
	require.NoError(t, err)

	got, err := repo.Get(ctx, want.ID)

	require.NoError(t, err)
	require.Equal(t, want.Name, got.Name)
	require.Equal(t, want.StartTime, got.StartTime)
	require.Equal(t, StatusSetup, got.Status)
	require.Equal(t, want.Cipher, got.Cipher)
	require.InDelta(t, *want.Start.Lat, *got.Start.Lat, 1e-9)
	require.Equal(t, want.Start.RadiusM, got.Start.RadiusM)
	require.Equal(t, want.EventDate.Format(dateLayout), got.EventDate.Format(dateLayout))
}

func TestRepo_Get_UnknownIsNotFound(t *testing.T) {
	repo := NewRepo(storetest.DB(t))

	_, err := repo.Get(context.Background(), "0123456789abcdef0123456789abcdef")

	require.ErrorIs(t, err, ErrNotFound)
}

func TestRepo_Update_PersistsAndReportsMissingRows(t *testing.T) {
	repo := NewRepo(storetest.DB(t))
	ctx := context.Background()
	created, err := NewService(repo).Create(ctx, validInput())
	require.NoError(t, err)

	created.Status = StatusActive
	created.Name = "Renamed"
	require.NoError(t, repo.Update(ctx, created))

	got, err := repo.Get(ctx, created.ID)
	require.NoError(t, err)
	require.Equal(t, StatusActive, got.Status)
	require.Equal(t, "Renamed", got.Name)

	require.ErrorIs(t, repo.Update(ctx, Event{ID: "0123456789abcdef0123456789abcdef"}), ErrNotFound)
}

// An unplaced geofence must round-trip as NULL, not as a zero coordinate off
// the coast of Africa.
func TestRepo_NullBoundaryRoundTrips(t *testing.T) {
	repo := NewRepo(storetest.DB(t))
	ctx := context.Background()
	in := validInput()
	in.End = Boundary{RadiusM: 30}
	created, err := NewService(repo).Create(ctx, in)
	require.NoError(t, err)

	got, err := repo.Get(ctx, created.ID)

	require.NoError(t, err)
	require.Nil(t, got.End.Lat)
	require.Nil(t, got.End.Lng)
	require.Empty(t, got.End.Label)
	require.False(t, got.End.IsPlaced())
}

func TestRepo_Search_FiltersAndPaginates(t *testing.T) {
	repo := NewRepo(storetest.DB(t))
	ctx := context.Background()
	svc := NewService(repo)
	for i := range 3 {
		in := validInput()
		in.Name = string(rune('A'+i)) + " Rally"
		created, err := svc.Create(ctx, in)
		require.NoError(t, err)
		if i == 0 {
			created.Status = StatusActive
			require.NoError(t, repo.Update(ctx, created))
		}
	}

	setup, total, err := repo.Search(ctx, httpx.Page{Offset: 0, Limit: 10}, SearchFilter{Status: StatusSetup})
	require.NoError(t, err)
	require.Equal(t, 2, total)
	require.Len(t, setup, 2)

	firstPage, total, err := repo.Search(ctx, httpx.Page{Offset: 0, Limit: 1}, SearchFilter{})
	require.NoError(t, err)
	require.Equal(t, 3, total)
	require.Len(t, firstPage, 1)

	beyondEnd, total, err := repo.Search(ctx, httpx.Page{Offset: 99, Limit: 10}, SearchFilter{})
	require.NoError(t, err)
	require.Equal(t, 3, total)
	require.Empty(t, beyondEnd)
}

func TestRepo_Search_EmptyTable(t *testing.T) {
	repo := NewRepo(storetest.DB(t))

	found, total, err := repo.Search(context.Background(), httpx.Page{Offset: 0, Limit: 10}, SearchFilter{})

	require.NoError(t, err)
	require.Zero(t, total)
	require.Empty(t, found)
}

// Stats backs the A1 dashboard cards, so each count must be scoped to its own
// event: a second rally's vehicles, crews and tasks must not leak in.
func TestRepo_Stats_CountsOnlyTheEventsOwnRows(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	ctx := context.Background()
	svc := NewService(repo)

	mine, err := svc.Create(ctx, validInput())
	require.NoError(t, err)
	other := validInput()
	other.Name = "Other Rally"
	theirs, err := svc.Create(ctx, other)
	require.NoError(t, err)

	seedFleet(t, db, mine.ID, "PKT", 2, 3)
	seedFleet(t, db, theirs.ID, "OTH", 5, 1)
	seedTasks(t, db, mine.ID, 15)
	seedTasks(t, db, theirs.ID, 4)
	// Two alerts on the event's own fleet, one of them already resolved, plus
	// one on the other event's fleet.
	seedAlert(t, db, vehicleIDOf(t, db, mine.ID, "PKT-001"), false)
	seedAlert(t, db, vehicleIDOf(t, db, mine.ID, "PKT-002"), true)
	seedAlert(t, db, vehicleIDOf(t, db, theirs.ID, "OTH-001"), false)

	got, err := repo.Stats(ctx, mine.ID)

	require.NoError(t, err)
	require.Equal(t, Stats{Vehicles: 2, Crews: 6, Tasks: 15, OpenAlerts: 1}, got)
}

func TestRepo_Stats_EmptyEventIsAllZeroes(t *testing.T) {
	repo := NewRepo(storetest.DB(t))
	ctx := context.Background()
	created, err := NewService(repo).Create(ctx, validInput())
	require.NoError(t, err)

	got, err := repo.Stats(ctx, created.ID)

	require.NoError(t, err)
	require.Equal(t, Stats{}, got)
}

func TestRepo_RouteRefsAreLoadedInDisplayOrder(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	ctx := context.Background()
	created, err := NewService(repo).Create(ctx, validInput())
	require.NoError(t, err)
	// Inserted out of order so the assertion proves the ORDER BY, not the
	// insertion sequence.
	seedRoute(t, db, created.ID, "Wetlands", 2)
	seedRoute(t, db, created.ID, "Inland", 1)

	got, err := repo.Get(ctx, created.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"Inland", "Wetlands"}, routeNamesOf(got))

	page, _, err := repo.Search(ctx, httpx.Page{Offset: 0, Limit: 10}, SearchFilter{})
	require.NoError(t, err)
	require.Len(t, page, 1)
	require.Equal(t, []string{"Inland", "Wetlands"}, routeNamesOf(page[0]))
}

func TestRepo_RouteRefsAreEmptyWhenNoRoutesExist(t *testing.T) {
	repo := NewRepo(storetest.DB(t))
	ctx := context.Background()
	created, err := NewService(repo).Create(ctx, validInput())
	require.NoError(t, err)

	got, err := repo.Get(ctx, created.ID)

	require.NoError(t, err)
	require.Empty(t, got.Routes)
}

func routeNamesOf(e Event) []string {
	names := make([]string, 0, len(e.Routes))
	for _, r := range e.Routes {
		names = append(names, r.Name)
	}

	return names
}

// seedFleet inserts vehicles numbered <prefix>-001.. each carrying crewPer
// crew members.
func seedFleet(t *testing.T, db *sql.DB, eventID, prefix string, vehicles, crewPer int) {
	t.Helper()

	for i := 1; i <= vehicles; i++ {
		vehicleID := store.NewID()
		_, err := db.Exec(
			"INSERT INTO vehicle (id, event_id, code, team_name) VALUES (?, ?, ?, ?)",
			vehicleID, eventID, fmt.Sprintf("%s-%03d", prefix, i), fmt.Sprintf("Team %d", i))
		require.NoError(t, err)

		for j := 1; j <= crewPer; j++ {
			crewID := store.NewID()
			_, err := db.Exec(
				"INSERT INTO crew_member (id, vehicle_id, name, email, phone_number) VALUES (?, ?, ?, ?, ?)",
				crewID, vehicleID, fmt.Sprintf("Member %d", j),
				// Unique per row: crew_member is unique on (vehicle_id, email).
				fmt.Sprintf("member-%s@wso2.com", crewID), fmt.Sprintf("07700900%03d", j))
			require.NoError(t, err)
		}
	}
}

func seedTasks(t *testing.T, db *sql.DB, eventID string, count int) {
	t.Helper()

	for i := 1; i <= count; i++ {
		_, err := db.Exec(
			"INSERT INTO task (id, event_id, code, title, type, `trigger`, points, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			store.NewID(), eventID, fmt.Sprintf("T%d", i), fmt.Sprintf("Task %d", i),
			"INPUT_SELECT", "geofence", 10, "{}")
		require.NoError(t, err)
	}
}

func seedAlert(t *testing.T, db *sql.DB, vehicleID string, resolved bool) {
	t.Helper()

	var resolvedAt any
	if resolved {
		resolvedAt = time.Now().UTC()
	}
	_, err := db.Exec(
		"INSERT INTO vehicle_alert (id, vehicle_id, type, resolved_at) VALUES (?, ?, ?, ?)",
		store.NewID(), vehicleID, "breakdown", resolvedAt)
	require.NoError(t, err)
}

func seedRoute(t *testing.T, db *sql.DB, eventID, name string, order int) {
	t.Helper()

	_, err := db.Exec(
		"INSERT INTO route (id, event_id, name, display_order) VALUES (?, ?, ?, ?)",
		store.NewID(), eventID, name, order)
	require.NoError(t, err)
}

func vehicleIDOf(t *testing.T, db *sql.DB, eventID, code string) string {
	t.Helper()

	var id string
	require.NoError(t, db.QueryRow(
		"SELECT id FROM vehicle WHERE event_id = ? AND code = ?", eventID, code).Scan(&id))

	return id
}
