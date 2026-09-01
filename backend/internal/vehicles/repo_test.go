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
	"bytes"
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/storetest"
)

// seedEventWithRoutes creates the parent event plus the two named routes the
// CSV fixtures refer to.
func seedEventWithRoutes(t *testing.T, db *sql.DB) string {
	t.Helper()

	eventID := store.NewID()
	_, err := db.Exec(
		"INSERT INTO event (id, name, event_date, start_time, created_by) VALUES (?, 'Rally', '2027-02-13', '09:00', 'u')",
		eventID)
	require.NoError(t, err)

	for _, name := range []string{"Inland", "Wetlands"} {
		_, err := db.Exec("INSERT INTO route (id, event_id, name) VALUES (?, ?, ?)", store.NewID(), eventID, name)
		require.NoError(t, err)
	}

	return eventID
}

func TestRepo_CreateGetRoundTripWithCrew(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	svc := NewService(repo)
	ctx := context.Background()
	in := validInput()
	in.EventID = seedEventWithRoutes(t, db)
	in.RouteID = ""

	created, err := svc.Create(ctx, in)
	require.NoError(t, err)

	got, err := repo.Get(ctx, created.ID)
	require.NoError(t, err)
	require.Equal(t, "PKT-001", got.Code)
	require.Equal(t, StatusOK, got.Status)
	require.Len(t, got.Crew, 2)
	require.Equal(t, "Nimal", got.Crew[0].Name)
	require.Equal(t, "LK", got.Crew[0].OriginCountry)
}

func TestRepo_Get_UnknownIsNotFound(t *testing.T) {
	repo := NewRepo(storetest.DB(t))

	_, err := repo.Get(context.Background(), store.NewID())

	require.ErrorIs(t, err, ErrNotFound)
}

func TestRepo_DuplicateCodeInSameEvent(t *testing.T) {
	db := storetest.DB(t)
	svc := NewService(NewRepo(db))
	ctx := context.Background()
	in := validInput()
	in.EventID = seedEventWithRoutes(t, db)
	in.RouteID = ""
	_, err := svc.Create(ctx, in)
	require.NoError(t, err)

	_, err = svc.Create(ctx, in)

	require.ErrorIs(t, err, ErrDuplicateCode)
}

func TestRepo_Update_ReplacesCrew(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	svc := NewService(repo)
	ctx := context.Background()
	in := validInput()
	in.EventID = seedEventWithRoutes(t, db)
	in.RouteID = ""
	created, err := svc.Create(ctx, in)
	require.NoError(t, err)
	newCrew := []CrewMemberInput{
		{Name: "Kamala", PhoneNumber: "0779876543", Role: RoleNavigator},
	}

	_, err = svc.Update(ctx, created.ID, UpdateVehicleInput{Crew: &newCrew})
	require.NoError(t, err)

	got, err := repo.Get(ctx, created.ID)
	require.NoError(t, err)
	require.Len(t, got.Crew, 1)
	require.Equal(t, "Kamala", got.Crew[0].Name)

	var orphans int
	require.NoError(t, db.QueryRow(
		"SELECT COUNT(*) FROM crew_member WHERE vehicle_id = ?", created.ID).Scan(&orphans))
	require.Equal(t, 1, orphans, "the previous crew rows must be gone, not orphaned")
}

func TestRepo_SetStatus_UnknownVehicleIsNotFound(t *testing.T) {
	repo := NewRepo(storetest.DB(t))

	err := repo.SetStatus(context.Background(), store.NewID(), StatusBreakdown)

	require.ErrorIs(t, err, ErrNotFound)
}

// Setting the status a vehicle already has affects zero rows in MySQL; that
// must not be mistaken for a missing vehicle.
func TestRepo_SetStatus_NoOpIsNotAnError(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	svc := NewService(repo)
	ctx := context.Background()
	in := validInput()
	in.EventID = seedEventWithRoutes(t, db)
	in.RouteID = ""
	created, err := svc.Create(ctx, in)
	require.NoError(t, err)

	require.NoError(t, repo.SetStatus(ctx, created.ID, StatusOK))
}

func TestRepo_ImportExportCSVRoundTrip(t *testing.T) {
	db := storetest.DB(t)
	svc := NewService(NewRepo(db))
	ctx := context.Background()
	eventID := seedEventWithRoutes(t, db)

	imported, err := svc.ImportCSV(ctx, eventID, strings.NewReader(importCSV))
	require.NoError(t, err)
	require.Equal(t, 2, imported)

	var out bytes.Buffer
	require.NoError(t, svc.ExportCSV(ctx, eventID, &out))
	require.Equal(t, importCSV, out.String())
}

func TestRepo_ImportCSV_RollsBackOnDuplicateCode(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	svc := NewService(repo)
	ctx := context.Background()
	eventID := seedEventWithRoutes(t, db)
	_, err := svc.ImportCSV(ctx, eventID, strings.NewReader(importCSV))
	require.NoError(t, err)

	// Re-importing the same file collides on the first code.
	_, err = svc.ImportCSV(ctx, eventID, strings.NewReader(importCSV))

	require.ErrorIs(t, err, ErrDuplicateCode)
	var count int
	require.NoError(t, db.QueryRow("SELECT COUNT(*) FROM vehicle WHERE event_id = ?", eventID).Scan(&count))
	require.Equal(t, 2, count, "the failed import must not have added rows")
}

func TestRepo_Search_PaginatesByCode(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	svc := NewService(repo)
	ctx := context.Background()
	eventID := seedEventWithRoutes(t, db)
	_, err := svc.ImportCSV(ctx, eventID, strings.NewReader(importCSV))
	require.NoError(t, err)

	found, total, err := repo.Search(ctx, eventID, SearchFilter{}, httpx.Page{Offset: 0, Limit: 1})

	require.NoError(t, err)
	require.Equal(t, 2, total)
	require.Len(t, found, 1)
	require.Equal(t, "PKT-001", found[0].Code)
	require.Len(t, found[0].Crew, 2, "search results carry their crew")
}

// The filter has to narrow the count as well as the rows, or a filtered table
// would page through totals it cannot show.
func TestRepo_Search_FiltersNarrowTheTotal(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	svc := NewService(repo)
	ctx := context.Background()
	eventID := seedEventWithRoutes(t, db)
	_, err := svc.ImportCSV(ctx, eventID, strings.NewReader(importCSV))
	require.NoError(t, err)
	page := httpx.Page{Offset: 0, Limit: 20}

	found, total, err := repo.Search(ctx, eventID, SearchFilter{Query: "002"}, page)
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, "PKT-002", found[0].Code)

	// "%" is a LIKE wildcard; escaped, it matches no code rather than every one.
	_, total, err = repo.Search(ctx, eventID, SearchFilter{Query: "%"}, page)
	require.NoError(t, err)
	require.Zero(t, total, "wildcards in the query are escaped, not honoured")
}

func TestRepo_Delete_RemovesTheVehicleAndItsCrew(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	svc := NewService(repo)
	ctx := context.Background()
	eventID := seedEventWithRoutes(t, db)
	_, err := svc.ImportCSV(ctx, eventID, strings.NewReader(importCSV))
	require.NoError(t, err)
	found, _, err := repo.Search(ctx, eventID, SearchFilter{Query: "PKT-001"}, httpx.Page{Offset: 0, Limit: 20})
	require.NoError(t, err)
	vehicle := found[0]

	require.NoError(t, svc.Delete(ctx, vehicle.ID))

	_, err = repo.Get(ctx, vehicle.ID)
	require.ErrorIs(t, err, ErrNotFound)

	var crewRows int
	require.NoError(t, db.QueryRow(
		"SELECT COUNT(*) FROM crew_member WHERE vehicle_id = ?", vehicle.ID).Scan(&crewRows))
	require.Zero(t, crewRows, "the crew cascades with its vehicle")
}

// The service checks HasRun before calling Delete, but a session can be created
// in between. The delete itself must refuse, or the cascade takes the session,
// its alerts and its submissions with it.
func TestRepo_Delete_RefusesAVehicleThatGainedASession(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	svc := NewService(repo)
	ctx := context.Background()
	eventID := seedEventWithRoutes(t, db)
	_, err := svc.ImportCSV(ctx, eventID, strings.NewReader(importCSV))
	require.NoError(t, err)
	found, _, err := repo.Search(ctx, eventID, SearchFilter{Query: "PKT-001"}, httpx.Page{Offset: 0, Limit: 20})
	require.NoError(t, err)
	vehicle := found[0]

	// Stands in for the session that commits between the guard and the delete:
	// the repository is called directly, exactly as it would be after losing
	// that race.
	_, err = db.Exec(
		"INSERT INTO team_session (id, event_id, vehicle_id, status) VALUES (?, ?, ?, 'bound')",
		store.NewID(), eventID, vehicle.ID)
	require.NoError(t, err)

	require.ErrorIs(t, repo.Delete(ctx, vehicle.ID), ErrHasRun)

	_, err = repo.Get(ctx, vehicle.ID)
	require.NoError(t, err, "the vehicle survives")

	var sessions int
	require.NoError(t, db.QueryRow(
		"SELECT COUNT(*) FROM team_session WHERE vehicle_id = ?", vehicle.ID).Scan(&sessions))
	require.Equal(t, 1, sessions, "and so does the session it would have cascaded")
}

func TestRepo_HasRun_SeesASession(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	svc := NewService(repo)
	ctx := context.Background()
	eventID := seedEventWithRoutes(t, db)
	_, err := svc.ImportCSV(ctx, eventID, strings.NewReader(importCSV))
	require.NoError(t, err)
	found, _, err := repo.Search(ctx, eventID, SearchFilter{Query: "PKT-001"}, httpx.Page{Offset: 0, Limit: 20})
	require.NoError(t, err)
	vehicle := found[0]

	hasRun, err := repo.HasRun(ctx, vehicle.ID)
	require.NoError(t, err)
	require.False(t, hasRun)

	_, err = db.Exec(
		"INSERT INTO team_session (id, event_id, vehicle_id, status) VALUES (?, ?, ?, 'bound')",
		store.NewID(), eventID, vehicle.ID)
	require.NoError(t, err)

	hasRun, err = repo.HasRun(ctx, vehicle.ID)
	require.NoError(t, err)
	require.True(t, hasRun, "a bound session already counts as a run")

	require.ErrorIs(t, svc.Delete(ctx, vehicle.ID), ErrHasRun)
}
