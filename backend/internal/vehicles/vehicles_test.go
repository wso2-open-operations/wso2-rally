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
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
)

const eventID = "0123456789abcdef0123456789abcdef"

type fakeRepo struct {
	stored    map[string]Vehicle
	routes    map[string]string // name -> id
	codeTaken bool
	// raced marks vehicle ids that already have a session, which is what makes
	// a delete a refused correction rather than an allowed one.
	raced map[string]bool
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		stored: map[string]Vehicle{},
		routes: map[string]string{"Inland": "route-inland", "Wetlands": "route-wetlands"},
		raced:  map[string]bool{},
	}
}

func (f *fakeRepo) Create(ctx context.Context, v Vehicle) error {
	return f.CreateMany(ctx, []Vehicle{v})
}

func (f *fakeRepo) CreateMany(_ context.Context, list []Vehicle) error {
	if f.codeTaken {
		return ErrDuplicateCode
	}
	for _, v := range list {
		f.stored[v.ID] = v
	}
	return nil
}

func (f *fakeRepo) Get(_ context.Context, id string) (Vehicle, error) {
	v, ok := f.stored[id]
	if !ok {
		return Vehicle{}, ErrNotFound
	}
	return v, nil
}

func (f *fakeRepo) Update(_ context.Context, v Vehicle) error {
	if _, ok := f.stored[v.ID]; !ok {
		return ErrNotFound
	}
	f.stored[v.ID] = v
	return nil
}

func (f *fakeRepo) Delete(_ context.Context, id string) error {
	if _, ok := f.stored[id]; !ok {
		return ErrNotFound
	}
	delete(f.stored, id)
	return nil
}

func (f *fakeRepo) HasRun(_ context.Context, vehicleID string) (bool, error) {
	return f.raced[vehicleID], nil
}

func (f *fakeRepo) Search(
	_ context.Context, eventID string, filter SearchFilter, page httpx.Page,
) ([]Vehicle, int, error) {
	matched := f.byEvent(eventID)
	if filter.Query != "" {
		needle := strings.ToLower(filter.Query)
		matched = slices.DeleteFunc(matched, func(v Vehicle) bool {
			return !strings.Contains(strings.ToLower(v.Code), needle) &&
				!strings.Contains(strings.ToLower(v.TeamName), needle)
		})
	}
	if filter.RouteID != "" {
		matched = slices.DeleteFunc(matched, func(v Vehicle) bool {
			return v.RouteID != filter.RouteID
		})
	}
	total := len(matched)
	if page.Offset >= total {
		return nil, total, nil
	}
	return matched[page.Offset:min(page.Offset+page.Limit, total)], total, nil
}

func (f *fakeRepo) ListByEvent(_ context.Context, eventID string) ([]Vehicle, error) {
	return f.byEvent(eventID), nil
}

func (f *fakeRepo) byEvent(eventID string) []Vehicle {
	var matched []Vehicle
	for _, v := range f.stored {
		if v.EventID == eventID {
			matched = append(matched, v)
		}
	}
	slices.SortFunc(matched, func(a, b Vehicle) int { return strings.Compare(a.Code, b.Code) })
	return matched
}

func (f *fakeRepo) SetStatus(_ context.Context, vehicleID string, status Status) error {
	v, ok := f.stored[vehicleID]
	if !ok {
		return ErrNotFound
	}
	v.Status = status
	f.stored[vehicleID] = v
	return nil
}

func (f *fakeRepo) RouteNamesByID(_ context.Context, _ string) (map[string]string, error) {
	byID := map[string]string{}
	for name, id := range f.routes {
		byID[id] = name
	}
	return byID, nil
}

func (f *fakeRepo) RouteIDsByName(_ context.Context, _ string) (map[string]string, error) {
	return f.routes, nil
}

func validInput() CreateVehicleInput {
	return CreateVehicleInput{
		EventID:       eventID,
		Code:          "PKT-001",
		TeamName:      "Packet Pioneers",
		VehicleType:   "SUV",
		ContactNumber: "+94771234567",
		RouteID:       "route-inland",
		Crew: []CrewMemberInput{
			{Name: "Nimal", PhoneNumber: "0771112233", Role: RoleNavigator, OriginCountry: "LK"},
			{Name: "Sunil", PhoneNumber: "0719998877"},
		},
	}
}

func TestService_Create_AssignsIDsAndDefaults(t *testing.T) {
	got, err := NewService(newFakeRepo()).Create(context.Background(), validInput())

	require.NoError(t, err)
	require.Len(t, got.ID, 32)
	require.Equal(t, StatusOK, got.Status)
	require.Len(t, got.Crew, 2)
	require.Equal(t, RoleNavigator, got.Crew[0].Role)
	require.Equal(t, RoleNode, got.Crew[1].Role, "an unset crew role defaults to node")
	require.Equal(t, got.ID, got.Crew[0].VehicleID)
	require.Len(t, got.Crew[0].ID, 32)
}

func TestService_Create_Validation(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*CreateVehicleInput)
		wantMsg string
	}{
		{"missing event", func(in *CreateVehicleInput) { in.EventID = "" }, "event id"},
		{"blank code", func(in *CreateVehicleInput) { in.Code = "  " }, "code"},
		{"blank team", func(in *CreateVehicleInput) { in.TeamName = "" }, "team name"},
		{"blank crew name", func(in *CreateVehicleInput) { in.Crew[1].Name = " " }, "crew member name"},
		{"unknown crew role", func(in *CreateVehicleInput) { in.Crew[0].Role = "driver" }, "crew role"},
		// A member joins by typing the last four digits of their own number, so
		// one without a number on file could never get into the car.
		{"blank crew phone", func(in *CreateVehicleInput) { in.Crew[1].PhoneNumber = " " }, "phone number"},
		{"crew phone too short", func(in *CreateVehicleInput) { in.Crew[0].PhoneNumber = "123" }, "phone number"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := validInput()
			tt.mutate(&in)

			_, err := NewService(newFakeRepo()).Create(context.Background(), in)

			require.ErrorIs(t, err, apperr.ErrValidation)
			require.Contains(t, err.Error(), tt.wantMsg)
		})
	}
}

func TestService_Create_DuplicateCodeIsConflict(t *testing.T) {
	repo := newFakeRepo()
	repo.codeTaken = true

	_, err := NewService(repo).Create(context.Background(), validInput())

	require.ErrorIs(t, err, apperr.ErrConflict)
}

func TestService_Update_ReplacesCrewWholesale(t *testing.T) {
	svc := NewService(newFakeRepo())
	created, err := svc.Create(context.Background(), validInput())
	require.NoError(t, err)
	newCrew := []CrewMemberInput{{Name: "Kamala", PhoneNumber: "0761234567", Role: RoleNavigator}}

	updated, err := svc.Update(context.Background(), created.ID, UpdateVehicleInput{Crew: &newCrew})

	require.NoError(t, err)
	require.Len(t, updated.Crew, 1)
	require.Equal(t, "Kamala", updated.Crew[0].Name)
	require.Equal(t, created.Code, updated.Code)
}

func TestService_Update_UnknownIsNotFound(t *testing.T) {
	_, err := NewService(newFakeRepo()).Update(context.Background(), "missing", UpdateVehicleInput{})

	require.ErrorIs(t, err, ErrNotFound)
}

func TestService_SetStatus(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	created, err := svc.Create(context.Background(), validInput())
	require.NoError(t, err)

	require.NoError(t, svc.SetStatus(context.Background(), created.ID, StatusBreakdown))

	got, err := repo.Get(context.Background(), created.ID)
	require.NoError(t, err)
	require.Equal(t, StatusBreakdown, got.Status)
}

func TestService_SetStatus_RejectsUnknownStatus(t *testing.T) {
	err := NewService(newFakeRepo()).SetStatus(context.Background(), "any", "on fire")

	require.ErrorIs(t, err, apperr.ErrValidation)
}

// Each crew member is Name:phone. A bare name is rejected, because the phone
// number is what lets that member join their car.
const importCSV = `code,team_name,vehicle_type,contact_number,route_name,crew_names
PKT-001,Packet Pioneers,SUV,+94771234567,Inland,Nimal:0771112233|Sunil:0719998877
PKT-002,Byte Brigade,Van,+94777654321,Wetlands,Kamala:0761234567
`

func TestService_ImportCSV_CreatesVehiclesAndCrew(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	ctx := context.Background()

	imported, err := svc.ImportCSV(ctx, eventID, strings.NewReader(importCSV))

	require.NoError(t, err)
	require.Equal(t, 2, imported)

	stored, err := repo.ListByEvent(ctx, eventID)
	require.NoError(t, err)
	require.Len(t, stored, 2)
	require.Equal(t, "PKT-001", stored[0].Code)
	require.Equal(t, "route-inland", stored[0].RouteID, "route names resolve to ids")
	require.Len(t, stored[0].Crew, 2)
	require.Equal(t, RoleNavigator, stored[0].Crew[0].Role, "the first crew member is the expected navigator")
	require.Equal(t, RoleNode, stored[0].Crew[1].Role)
	require.Equal(t, "Nimal", stored[0].Crew[0].Name)
	require.Equal(t, "0771112233", stored[0].Crew[0].PhoneNumber)
	require.Equal(t, "0719998877", stored[0].Crew[1].PhoneNumber)
	require.Equal(t, "route-wetlands", stored[1].RouteID)
}

func TestService_ImportCSV_RequiresPhonePerCrewMember(t *testing.T) {
	tests := map[string]string{
		"bare name":         "Nimal",
		"one of two bare":   "Nimal:0771112233|Sunil",
		"empty phone":       "Nimal:",
		"empty name":        ":0771112233",
		"phone too short":   "Nimal:123",
		"phone not digits":  "Nimal:abcdefg",
		"separator missing": "Nimal 0771112233",
	}
	for name, crew := range tests {
		t.Run(name, func(t *testing.T) {
			body := "code,team_name,vehicle_type,contact_number,route_name,crew_names\n" +
				"PKT-001,Team,SUV,1,Inland," + crew + "\n"

			_, err := NewService(newFakeRepo()).ImportCSV(context.Background(), eventID, strings.NewReader(body))

			require.ErrorIs(t, err, apperr.ErrValidation)
		})
	}
}

// A file that names a member without a number must be rejected whole, not
// imported with an unjoinable crew — the same all-or-nothing rule the rest of
// the importer follows.
func TestService_ImportCSV_MissingPhoneLeavesNothingBehind(t *testing.T) {
	repo := newFakeRepo()
	body := "code,team_name,vehicle_type,contact_number,route_name,crew_names\n" +
		"PKT-001,Team One,SUV,1,Inland,Nimal:0771112233\n" +
		"PKT-002,Team Two,Van,2,Inland,Sunil\n"

	_, err := NewService(repo).ImportCSV(context.Background(), eventID, strings.NewReader(body))

	require.ErrorIs(t, err, apperr.ErrValidation)
	require.Empty(t, repo.stored)
}

func TestService_ImportCSV_Rejections(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantMsg string
	}{
		{"empty file", "", "empty"},
		{"header only", "code,team_name,vehicle_type,contact_number,route_name,crew_names\n", "no vehicles"},
		{
			"wrong columns",
			"vehicle,team,type,phone,route,crew\nPKT-001,T,SUV,1,Inland,A:0771112233\n",
			"column 1",
		},
		{
			"missing code",
			"code,team_name,vehicle_type,contact_number,route_name,crew_names\n,Team,SUV,1,Inland,A\n",
			"no vehicle code",
		},
		{
			"missing team name",
			"code,team_name,vehicle_type,contact_number,route_name,crew_names\nPKT-001,,SUV,1,Inland,A\n",
			"no team name",
		},
		{
			"unknown route",
			"code,team_name,vehicle_type,contact_number,route_name,crew_names\nPKT-001,Team,SUV,1,Highlands,A:0771112233\n",
			"does not exist",
		},
		{
			"duplicate code within the file",
			"code,team_name,vehicle_type,contact_number,route_name,crew_names\n" +
				"PKT-001,Team,SUV,1,Inland,A:0771112233\nPKT-001,Other,Van,2,Inland,B:0719998877\n",
			"more than once",
		},
		{
			"ragged row",
			"code,team_name,vehicle_type,contact_number,route_name,crew_names\nPKT-001,Team,SUV\n",
			"line 2",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewService(newFakeRepo()).ImportCSV(context.Background(), eventID, strings.NewReader(tt.body))

			require.ErrorIs(t, err, apperr.ErrValidation)
			require.Contains(t, err.Error(), tt.wantMsg)
		})
	}
}

// A rejected file must leave the event untouched, not half-provisioned.
func TestService_ImportCSV_IsAllOrNothing(t *testing.T) {
	repo := newFakeRepo()
	body := "code,team_name,vehicle_type,contact_number,route_name,crew_names\n" +
		"PKT-001,Team One,SUV,1,Inland,A:0771112233\nPKT-002,Team Two,Van,2,Highlands,B:0719998877\n"

	_, err := NewService(repo).ImportCSV(context.Background(), eventID, strings.NewReader(body))

	require.Error(t, err)
	require.Empty(t, repo.stored)
}

func TestService_ImportCSV_AcceptsMissingRouteAndCrew(t *testing.T) {
	repo := newFakeRepo()
	body := "code,team_name,vehicle_type,contact_number,route_name,crew_names\nPKT-009,Solo,Sedan,,,\n"

	imported, err := NewService(repo).ImportCSV(context.Background(), eventID, strings.NewReader(body))

	require.NoError(t, err)
	require.Equal(t, 1, imported)
	stored, err := repo.ListByEvent(context.Background(), eventID)
	require.NoError(t, err)
	require.Empty(t, stored[0].RouteID)
	require.Empty(t, stored[0].Crew)
}

func TestService_ImportCSV_ToleratesExcelBOM(t *testing.T) {
	repo := newFakeRepo()

	imported, err := NewService(repo).ImportCSV(context.Background(), eventID, strings.NewReader(utf8BOM+importCSV))

	require.NoError(t, err)
	require.Equal(t, 2, imported)
}

func TestService_ExportCSV_RoundTripsAnImport(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	ctx := context.Background()
	_, err := svc.ImportCSV(ctx, eventID, strings.NewReader(importCSV))
	require.NoError(t, err)

	var out bytes.Buffer
	require.NoError(t, svc.ExportCSV(ctx, eventID, &out))

	require.Equal(t, importCSV, out.String())
}

func TestService_ExportCSV_EmptyEventStillWritesHeader(t *testing.T) {
	var out bytes.Buffer

	require.NoError(t, NewService(newFakeRepo()).ExportCSV(context.Background(), eventID, &out))

	require.Equal(t, "code,team_name,vehicle_type,contact_number,route_name,crew_names\n", out.String())
}

// A vehicle that has already run carries its crew's score, submissions and
// alerts behind cascading foreign keys, so deleting one would erase a result
// rather than correct a typo.
func TestService_Delete_RefusesAVehicleThatHasRun(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	ctx := context.Background()
	vehicle, err := svc.Create(ctx, validInput())
	require.NoError(t, err)
	repo.raced[vehicle.ID] = true

	err = svc.Delete(ctx, vehicle.ID)

	require.ErrorIs(t, err, apperr.ErrConflict)
	require.Contains(t, repo.stored, vehicle.ID, "the vehicle must survive a refused delete")
}

func TestService_Delete_RemovesAProvisioningMistake(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	ctx := context.Background()
	vehicle, err := svc.Create(ctx, validInput())
	require.NoError(t, err)

	require.NoError(t, svc.Delete(ctx, vehicle.ID))

	require.NotContains(t, repo.stored, vehicle.ID)
}

func TestService_Delete_UnknownIsNotFound(t *testing.T) {
	err := NewService(newFakeRepo()).Delete(context.Background(), "0123456789abcdef0123456789abcdef")

	require.ErrorIs(t, err, apperr.ErrNotFound)
}

// The organizer's screen lists a hundred and fifty cars, so finding one by
// code or team name is the difference between a usable table and eight pages
// of scrolling.
func TestService_Search_FiltersByQueryAndRoute(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	ctx := context.Background()
	seed := func(code, team, routeID string) {
		in := validInput()
		in.Code, in.TeamName, in.RouteID = code, team, routeID
		_, err := svc.Create(ctx, in)
		require.NoError(t, err)
	}
	seed("PKT-001", "Data Dashers", "route-inland")
	seed("PKT-002", "Sync Squad", "route-wetlands")
	seed("PKT-087", "Null Pointers", "route-inland")

	page := httpx.Page{Offset: 0, Limit: 20}

	byCode, total, err := svc.Search(ctx, eventID, SearchFilter{Query: "pkt-087"}, page)
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, "PKT-087", byCode[0].Code)

	byTeam, total, err := svc.Search(ctx, eventID, SearchFilter{Query: "squad"}, page)
	require.NoError(t, err)
	require.Equal(t, 1, total, "the query matches team name as well as code")
	require.Equal(t, "PKT-002", byTeam[0].Code)

	byRoute, total, err := svc.Search(ctx, eventID, SearchFilter{RouteID: "route-inland"}, page)
	require.NoError(t, err)
	require.Equal(t, 2, total)
	require.Len(t, byRoute, 2)

	_, total, err = svc.Search(ctx, eventID, SearchFilter{}, page)
	require.NoError(t, err)
	require.Equal(t, 3, total, "the zero filter matches every vehicle of the event")
}
