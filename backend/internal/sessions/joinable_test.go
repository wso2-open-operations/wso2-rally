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
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/storetest"
)

// The roster is stored normalised, so the caller's address must be too, or a
// token that says "Nimal@WSO2.com " would find no car that join would accept.
func TestService_JoinableVehicles_MatchesTheCallerTheWayJoinDoes(t *testing.T) {
	svc, repo, _, _ := newService(t)
	repo.joinable = map[string][]JoinableVehicle{
		crewAEmail: {{VehicleID: testVehicleID, Code: "PKT-001", TeamName: "Packets", EventID: testEventID}},
	}

	got, err := svc.JoinableVehicles(context.Background(), "  "+strings.ToUpper(crewAEmail)+" ")

	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Equal(t, "PKT-001", got[0].Code)
}

// Nobody's roster has this address: an empty list, not an error. The screen
// says so and names the address, which is how a typo'd email gets noticed.
func TestService_JoinableVehicles_EmptyWhenOnNoCrew(t *testing.T) {
	svc, _, _, _ := newService(t)

	got, err := svc.JoinableVehicles(context.Background(), "stranger@wso2.com")

	require.NoError(t, err)
	require.Empty(t, got)
}

// Same rule as join: a token with no email cannot be matched to anyone, and
// there is no other identity to fall back to.
func TestService_JoinableVehicles_RequiresAnEmail(t *testing.T) {
	svc, _, _, _ := newService(t)

	_, err := svc.JoinableVehicles(context.Background(), " ")

	require.ErrorIs(t, err, apperr.ErrValidation)
}

func TestService_JoinableVehicles_ReportsARepoFailure(t *testing.T) {
	svc, repo, _, _ := newService(t)
	repo.joinableErr = errors.New("db down")

	_, err := svc.JoinableVehicles(context.Background(), crewAEmail)

	require.Error(t, err)
	require.NotErrorIs(t, err, apperr.ErrValidation)
}

func (f *fakeRepo) JoinableVehiclesOf(_ context.Context, email string) ([]JoinableVehicle, error) {
	if f.joinableErr != nil {
		return nil, f.joinableErr
	}
	return f.joinable[email], nil
}

// A crew member sees the cars they are on, in published events only — never a
// car whose roster they are not on, and never an event still being set up.
func TestRepo_JoinableVehiclesOf_OnlyTheCallersCarsInPublishedEvents(t *testing.T) {
	db := storetest.DB(t)
	ctx := context.Background()

	seedEvent := func(name, status string) string {
		id := store.NewID()
		_, err := db.Exec(
			"INSERT INTO event (id, name, event_date, start_time, status, created_by) "+
				"VALUES (?, ?, '2027-02-13', '09:00', ?, 'organizer@wso2.com')", id, name, status)
		require.NoError(t, err)
		return id
	}
	seedCar := func(eventID, code, team string, emails ...string) string {
		id := store.NewID()
		_, err := db.Exec("INSERT INTO vehicle (id, event_id, code, team_name) VALUES (?, ?, ?, ?)",
			id, eventID, code, team)
		require.NoError(t, err)
		for _, email := range emails {
			_, err := db.Exec(
				"INSERT INTO crew_member (id, vehicle_id, name, email, phone_number) VALUES (?, ?, ?, ?, '0770000000')",
				store.NewID(), id, email, email)
			require.NoError(t, err)
		}
		return id
	}

	live := seedEvent("Rally 2027", "active")
	draft := seedEvent("Rally 2028", "setup")
	mine := seedCar(live, "PKT-001", "Packets", "nimal@wso2.com", "ayesha@wso2.com")
	seedCar(live, "PKT-002", "Frames", "someone@wso2.com")
	seedCar(draft, "PKT-003", "Draft", "nimal@wso2.com")

	got, err := NewRepo(db).JoinableVehiclesOf(ctx, "nimal@wso2.com")

	require.NoError(t, err)
	require.Equal(t, []JoinableVehicle{{
		VehicleID: mine, Code: "PKT-001", TeamName: "Packets",
		EventID: live, EventName: "Rally 2027", EventDate: "2027-02-13", StartTime: "09:00",
	}}, got)
}

// Join matches the caller in Go, byte for byte once both sides are normalised.
// The column's default collation also folds accents, so a plain = here would
// offer jose@ a car that only josé@ can join — and join would then refuse them.
func TestRepo_JoinableVehiclesOf_DoesNotFoldAccents(t *testing.T) {
	db := storetest.DB(t)
	ctx := context.Background()

	eventID, vehicleID := store.NewID(), store.NewID()
	_, err := db.Exec(
		"INSERT INTO event (id, name, event_date, start_time, status, created_by) "+
			"VALUES (?, 'Rally 2027', '2027-02-13', '09:00', 'active', 'organizer@wso2.com')", eventID)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO vehicle (id, event_id, code, team_name) VALUES (?, ?, 'PKT-001', 'Packets')",
		vehicleID, eventID)
	require.NoError(t, err)
	_, err = db.Exec(
		"INSERT INTO crew_member (id, vehicle_id, name, email, phone_number) "+
			"VALUES (?, ?, 'José', 'josé@example.com', '0770000000')", store.NewID(), vehicleID)
	require.NoError(t, err)
	repo := NewRepo(db)

	got, err := repo.JoinableVehiclesOf(ctx, "jose@example.com")
	require.NoError(t, err)
	require.Empty(t, got, "jose@ is not josé@")

	got, err = repo.JoinableVehiclesOf(ctx, "josé@example.com")
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Equal(t, vehicleID, got[0].VehicleID)
}
