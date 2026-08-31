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
	"errors"
	"maps"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
)

// fakeRepo is an in-memory Repo. Service behaviour is the unit under test;
// the SQL implementation is covered by the DB-backed repo tests.
type fakeRepo struct {
	events    map[string]Event
	stats     map[string]Stats
	createErr error
	statsErr  error
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{events: map[string]Event{}, stats: map[string]Stats{}}
}

func (f *fakeRepo) Create(_ context.Context, e Event) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.events[e.ID] = e
	return nil
}

func (f *fakeRepo) Get(_ context.Context, id string) (Event, error) {
	e, ok := f.events[id]
	if !ok {
		return Event{}, ErrNotFound
	}
	return e, nil
}

func (f *fakeRepo) Update(_ context.Context, e Event) error {
	if _, ok := f.events[e.ID]; !ok {
		return ErrNotFound
	}
	f.events[e.ID] = e
	return nil
}

func (f *fakeRepo) Search(_ context.Context, page httpx.Page, filter SearchFilter) ([]Event, int, error) {
	matched := make([]Event, 0, len(f.events))
	for _, e := range slices.Sorted(maps.Keys(f.events)) {
		if filter.Status == "" || f.events[e].Status == filter.Status {
			matched = append(matched, f.events[e])
		}
	}
	total := len(matched)
	if page.Offset >= total {
		return nil, total, nil
	}
	end := min(page.Offset+page.Limit, total)

	return matched[page.Offset:end], total, nil
}

func (f *fakeRepo) Stats(_ context.Context, eventID string) (Stats, error) {
	if f.statsErr != nil {
		return Stats{}, f.statsErr
	}
	return f.stats[eventID], nil
}

func validInput() CreateEventInput {
	return CreateEventInput{
		Name:      "WSO2 Motor Rally 2027",
		EventDate: time.Date(2027, 2, 13, 0, 0, 0, 0, time.UTC),
		StartTime: "09:00",
		Start:     Boundary{Label: "Start line", Lat: ptr(6.8901), Lng: ptr(79.9200), RadiusM: 40},
		End:       Boundary{Label: "Pearl Bay", Lat: ptr(6.8480), Lng: ptr(79.9280), RadiusM: 30},
		CreatedBy: "organizer@wso2.com",
	}
}

func ptr[T any](v T) *T { return &v }

func TestService_Create_AssignsIDAndSetupStatus(t *testing.T) {
	svc := NewService(newFakeRepo())

	got, err := svc.Create(context.Background(), validInput())

	require.NoError(t, err)
	require.Len(t, got.ID, 32)
	require.Equal(t, StatusSetup, got.Status)
	require.Equal(t, "organizer@wso2.com", got.CreatedBy)
	require.False(t, got.CreatedOn.IsZero())
}

func TestService_Create_Validation(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*CreateEventInput)
		wantMsg string
	}{
		{"blank name", func(in *CreateEventInput) { in.Name = "   " }, "name"},
		{"missing date", func(in *CreateEventInput) { in.EventDate = time.Time{} }, "event date"},
		{"bad start time", func(in *CreateEventInput) { in.StartTime = "9am" }, "start time"},
		{"hour out of range", func(in *CreateEventInput) { in.StartTime = "25:00" }, "start time"},
		{"latitude out of range", func(in *CreateEventInput) { in.Start.Lat = ptr(91.0) }, "latitude"},
		{"longitude out of range", func(in *CreateEventInput) { in.End.Lng = ptr(-181.0) }, "longitude"},
		{"negative radius", func(in *CreateEventInput) { in.Start.RadiusM = -1 }, "radius"},
		{"missing creator", func(in *CreateEventInput) { in.CreatedBy = "" }, "created by"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := validInput()
			tt.mutate(&in)

			_, err := NewService(newFakeRepo()).Create(context.Background(), in)

			require.ErrorIs(t, err, ErrValidation)
			require.Contains(t, err.Error(), tt.wantMsg)
		})
	}
}

func TestService_Create_PropagatesRepoFailure(t *testing.T) {
	repo := newFakeRepo()
	repo.createErr = errors.New("db down")

	_, err := NewService(repo).Create(context.Background(), validInput())

	require.ErrorContains(t, err, "db down")
}

func TestService_Get_UnknownIsNotFound(t *testing.T) {
	_, err := NewService(newFakeRepo()).Get(context.Background(), "missing")

	require.ErrorIs(t, err, ErrNotFound)
}

func TestService_Publish_SetsActive(t *testing.T) {
	svc := NewService(newFakeRepo())
	created, err := svc.Create(context.Background(), validInput())
	require.NoError(t, err)

	published, err := svc.Publish(context.Background(), created.ID)

	require.NoError(t, err)
	require.Equal(t, StatusActive, published.Status)
}

func TestService_Publish_RequiresBothGeofences(t *testing.T) {
	svc := NewService(newFakeRepo())
	in := validInput()
	in.End.Lat, in.End.Lng = nil, nil
	created, err := svc.Create(context.Background(), in)
	require.NoError(t, err)

	_, err = svc.Publish(context.Background(), created.ID)

	require.ErrorIs(t, err, ErrValidation)
	require.Contains(t, err.Error(), "geofence")
}

func TestService_Publish_IsRejectedOnceComplete(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	created, err := svc.Create(context.Background(), validInput())
	require.NoError(t, err)
	created.Status = StatusComplete
	require.NoError(t, repo.Update(context.Background(), created))

	_, err = svc.Publish(context.Background(), created.ID)

	require.ErrorIs(t, err, ErrConflict)
}

func TestService_Update_AppliesOnlyProvidedFields(t *testing.T) {
	svc := NewService(newFakeRepo())
	created, err := svc.Create(context.Background(), validInput())
	require.NoError(t, err)

	updated, err := svc.Update(context.Background(), created.ID, UpdateEventInput{
		Name:   ptr("Renamed Rally"),
		Cipher: ptr("API Integration"),
	})

	require.NoError(t, err)
	require.Equal(t, "Renamed Rally", updated.Name)
	require.Equal(t, "API Integration", updated.Cipher)
	require.Equal(t, created.StartTime, updated.StartTime, "untouched fields must survive a PATCH")
	require.Equal(t, created.Start.RadiusM, updated.Start.RadiusM)
}

func TestService_Update_ValidatesNewValues(t *testing.T) {
	svc := NewService(newFakeRepo())
	created, err := svc.Create(context.Background(), validInput())
	require.NoError(t, err)

	_, err = svc.Update(context.Background(), created.ID, UpdateEventInput{StartTime: ptr("nope")})

	require.ErrorIs(t, err, ErrValidation)
}

func TestService_Update_UnknownIsNotFound(t *testing.T) {
	_, err := NewService(newFakeRepo()).Update(context.Background(), "missing", UpdateEventInput{})

	require.ErrorIs(t, err, ErrNotFound)
}

func TestService_Search_PaginatesAndFilters(t *testing.T) {
	svc := NewService(newFakeRepo())
	ctx := context.Background()
	for i := range 3 {
		in := validInput()
		in.Name = string(rune('A'+i)) + " Rally"
		_, err := svc.Create(ctx, in)
		require.NoError(t, err)
	}

	page, total, err := svc.Search(ctx, httpx.Page{Offset: 0, Limit: 2}, SearchFilter{Status: StatusSetup})

	require.NoError(t, err)
	require.Equal(t, 3, total)
	require.Len(t, page, 2)
}

func TestService_Search_RejectsUnknownStatus(t *testing.T) {
	_, _, err := NewService(newFakeRepo()).Search(context.Background(), httpx.Page{Limit: 10}, SearchFilter{Status: "nope"})

	require.ErrorIs(t, err, ErrValidation)
}

func TestService_Stats_ReturnsCountsForKnownEvent(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	ctx := context.Background()
	created, err := svc.Create(ctx, validInput())
	require.NoError(t, err)
	repo.stats[created.ID] = Stats{Vehicles: 150, Crews: 600, Tasks: 15, OpenAlerts: 3}

	got, err := svc.Stats(ctx, created.ID)

	require.NoError(t, err)
	require.Equal(t, Stats{Vehicles: 150, Crews: 600, Tasks: 15, OpenAlerts: 3}, got)
}

// The dashboard must not report zeroes for an event that does not exist —
// that would read as "provisioned but empty" rather than "wrong id".
func TestService_Stats_UnknownIsNotFound(t *testing.T) {
	_, err := NewService(newFakeRepo()).Stats(context.Background(), "missing")

	require.ErrorIs(t, err, ErrNotFound)
}

func TestService_Stats_PropagatesRepoFailure(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	created, err := svc.Create(context.Background(), validInput())
	require.NoError(t, err)
	repo.statsErr = errors.New("db down")

	_, err = svc.Stats(context.Background(), created.ID)

	require.ErrorContains(t, err, "db down")
}

func TestStatus_IsValid(t *testing.T) {
	require.True(t, StatusSetup.IsValid())
	require.True(t, StatusActive.IsValid())
	require.True(t, StatusComplete.IsValid())
	require.False(t, Status("archived").IsValid())
}
