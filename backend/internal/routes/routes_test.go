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

package routes

import (
	"context"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
)

// fakeRepo is an in-memory Repo covering the service's rules.
type fakeRepo struct {
	routes    map[string]Route
	waypoints map[string]Waypoint
	// attached records the task ids per waypoint, in attachment order.
	attached  map[string][]string
	nameTaken bool
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		routes:    map[string]Route{},
		waypoints: map[string]Waypoint{},
		attached:  map[string][]string{},
	}
}

func (f *fakeRepo) CreateRoute(_ context.Context, r Route) error {
	if f.nameTaken {
		return ErrDuplicateName
	}
	f.routes[r.ID] = r
	return nil
}

func (f *fakeRepo) GetRoute(_ context.Context, id string) (Route, error) {
	r, ok := f.routes[id]
	if !ok {
		return Route{}, ErrRouteNotFound
	}
	return r, nil
}

func (f *fakeRepo) ListRoutes(_ context.Context, eventID string) ([]Route, error) {
	var out []Route
	for _, r := range f.routes {
		if r.EventID == eventID {
			out = append(out, r)
		}
	}
	slices.SortFunc(out, func(a, b Route) int { return a.Order - b.Order })
	return out, nil
}

func (f *fakeRepo) UpdateRoute(_ context.Context, r Route) error {
	if _, ok := f.routes[r.ID]; !ok {
		return ErrRouteNotFound
	}
	f.routes[r.ID] = r
	return nil
}

func (f *fakeRepo) ListWaypoints(_ context.Context, routeID string) ([]Waypoint, error) {
	var out []Waypoint
	for _, w := range f.waypoints {
		if w.RouteID == routeID {
			w.TaskIDs = slices.Clone(f.attached[w.ID])
			out = append(out, w)
		}
	}
	slices.SortFunc(out, func(a, b Waypoint) int { return a.Order - b.Order })
	return out, nil
}

func (f *fakeRepo) GetWaypoint(_ context.Context, id string) (Waypoint, error) {
	w, ok := f.waypoints[id]
	if !ok {
		return Waypoint{}, ErrWaypointNotFound
	}
	w.TaskIDs = slices.Clone(f.attached[id])
	return w, nil
}

func (f *fakeRepo) CreateWaypoint(_ context.Context, w Waypoint) error {
	f.waypoints[w.ID] = w
	return nil
}

func (f *fakeRepo) UpdateWaypoint(_ context.Context, w Waypoint) error {
	if _, ok := f.waypoints[w.ID]; !ok {
		return ErrWaypointNotFound
	}
	f.waypoints[w.ID] = w
	return nil
}

func (f *fakeRepo) DeleteWaypoint(ctx context.Context, routeID, waypointID string) error {
	if _, ok := f.waypoints[waypointID]; !ok {
		return ErrWaypointNotFound
	}
	delete(f.waypoints, waypointID)
	delete(f.attached, waypointID)

	remaining, err := f.ListWaypoints(ctx, routeID)
	if err != nil {
		return err
	}
	for position, w := range remaining {
		// ListWaypoints hydrates TaskIDs; write back the stored row so the
		// fake keeps attachments in `attached` alone, as the real repo does.
		stored := f.waypoints[w.ID]
		stored.Order = position
		f.waypoints[w.ID] = stored
	}

	return nil
}

func (f *fakeRepo) ReorderWaypoints(_ context.Context, _ string, orderedIDs []string) error {
	for position, id := range orderedIDs {
		w := f.waypoints[id]
		w.Order = position
		f.waypoints[id] = w
	}
	return nil
}

func (f *fakeRepo) AttachTasks(_ context.Context, waypointID string, taskIDs []string) error {
	f.attached[waypointID] = slices.Clone(taskIDs)
	return nil
}

const eventID = "0123456789abcdef0123456789abcdef"

func newServiceWithRoute(t *testing.T) (*Service, *fakeRepo, Route) {
	t.Helper()

	repo := newFakeRepo()
	svc := NewService(repo)
	route, err := svc.CreateRoute(context.Background(), CreateRouteInput{EventID: eventID, Name: "Inland"})
	require.NoError(t, err)

	return svc, repo, route
}

func addWaypoints(t *testing.T, svc *Service, routeID string, labels ...string) []Waypoint {
	t.Helper()

	added := make([]Waypoint, 0, len(labels))
	for _, label := range labels {
		w, err := svc.AddWaypoint(context.Background(), AddWaypointInput{
			RouteID: routeID, Label: label, Lat: 6.89, Lng: 79.92, BoundaryRadiusM: 50,
		})
		require.NoError(t, err)
		added = append(added, w)
	}

	return added
}

func TestService_CreateRoute(t *testing.T) {
	svc := NewService(newFakeRepo())

	route, err := svc.CreateRoute(context.Background(), CreateRouteInput{EventID: eventID, Name: "  Wetlands  "})

	require.NoError(t, err)
	require.Len(t, route.ID, 32)
	require.Equal(t, "Wetlands", route.Name, "names are trimmed")
}

func TestService_CreateRoute_Validation(t *testing.T) {
	tests := []struct {
		name string
		in   CreateRouteInput
	}{
		{"missing event", CreateRouteInput{Name: "Inland"}},
		{"blank name", CreateRouteInput{EventID: eventID, Name: "  "}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewService(newFakeRepo()).CreateRoute(context.Background(), tt.in)

			require.ErrorIs(t, err, apperr.ErrValidation)
		})
	}
}

func TestService_CreateRoute_DuplicateNameIsConflict(t *testing.T) {
	repo := newFakeRepo()
	repo.nameTaken = true

	_, err := NewService(repo).CreateRoute(context.Background(), CreateRouteInput{EventID: eventID, Name: "Inland"})

	require.ErrorIs(t, err, apperr.ErrConflict)
}

func TestService_AddWaypoint_AppendsInOrder(t *testing.T) {
	svc, _, route := newServiceWithRoute(t)

	added := addWaypoints(t, svc, route.ID, "Kandy", "Matale", "Dambulla")

	require.Equal(t, []int{0, 1, 2}, []int{added[0].Order, added[1].Order, added[2].Order})
}

func TestService_AddWaypoint_Validation(t *testing.T) {
	svc, _, route := newServiceWithRoute(t)
	base := AddWaypointInput{RouteID: route.ID, Label: "Kandy", Lat: 6.89, Lng: 79.92, BoundaryRadiusM: 50}

	tests := []struct {
		name    string
		mutate  func(*AddWaypointInput)
		wantMsg string
	}{
		{"blank label", func(in *AddWaypointInput) { in.Label = " " }, "label"},
		{"latitude out of range", func(in *AddWaypointInput) { in.Lat = 95 }, "latitude"},
		{"longitude out of range", func(in *AddWaypointInput) { in.Lng = 200 }, "longitude"},
		{"zero radius", func(in *AddWaypointInput) { in.BoundaryRadiusM = 0 }, "radius"},
		{"negative radius", func(in *AddWaypointInput) { in.BoundaryRadiusM = -5 }, "radius"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := base
			tt.mutate(&in)

			_, err := svc.AddWaypoint(context.Background(), in)

			require.ErrorIs(t, err, apperr.ErrValidation)
			require.Contains(t, err.Error(), tt.wantMsg)
		})
	}
}

func TestService_AddWaypoint_UnknownRouteIsNotFound(t *testing.T) {
	svc := NewService(newFakeRepo())

	_, err := svc.AddWaypoint(context.Background(), AddWaypointInput{
		RouteID: "missing", Label: "Kandy", Lat: 6.89, Lng: 79.92, BoundaryRadiusM: 50,
	})

	require.ErrorIs(t, err, ErrRouteNotFound)
}

func TestService_GetRoute_IncludesWaypointsInOrder(t *testing.T) {
	svc, _, route := newServiceWithRoute(t)
	addWaypoints(t, svc, route.ID, "Kandy", "Matale")

	got, err := svc.GetRoute(context.Background(), route.ID)

	require.NoError(t, err)
	require.Len(t, got.Waypoints, 2)
	require.Equal(t, "Kandy", got.Waypoints[0].Label)
	require.Equal(t, "Matale", got.Waypoints[1].Label)
}

func TestService_ReorderWaypoints_PersistsNewOrder(t *testing.T) {
	svc, _, route := newServiceWithRoute(t)
	added := addWaypoints(t, svc, route.ID, "a", "b", "c")
	a, b, c := added[0].ID, added[1].ID, added[2].ID

	require.NoError(t, svc.ReorderWaypoints(context.Background(), route.ID, []string{c, a, b}))

	got, err := svc.GetRoute(context.Background(), route.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"c", "a", "b"}, []string{
		got.Waypoints[0].Label, got.Waypoints[1].Label, got.Waypoints[2].Label,
	})
}

func TestService_ReorderWaypoints_RejectsIncompleteOrDuplicateSets(t *testing.T) {
	svc, _, route := newServiceWithRoute(t)
	added := addWaypoints(t, svc, route.ID, "a", "b", "c")
	a, b := added[0].ID, added[1].ID

	tests := []struct {
		name    string
		ordered []string
	}{
		{"missing a waypoint", []string{a, b}},
		{"duplicate id", []string{a, a, b}},
		{"foreign id", []string{a, b, "0123456789abcdef0123456789abcdef"}},
		{"empty", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := svc.ReorderWaypoints(context.Background(), route.ID, tt.ordered)

			require.ErrorIs(t, err, apperr.ErrValidation)
		})
	}
}

// Removing a leg has to close the gap it leaves: display_order is what the
// in-car "next waypoint" walk counts through, so a hole would strand a crew.
func TestService_DeleteWaypoint_ClosesTheGapInTheOrder(t *testing.T) {
	svc, _, route := newServiceWithRoute(t)
	added := addWaypoints(t, svc, route.ID, "a", "b", "c")

	got, err := svc.DeleteWaypoint(context.Background(), added[1].ID)

	require.NoError(t, err)
	require.Equal(t, []string{"a", "c"}, []string{got.Waypoints[0].Label, got.Waypoints[1].Label})
	require.Equal(t, []int{0, 1}, []int{got.Waypoints[0].Order, got.Waypoints[1].Order})
}

func TestService_DeleteWaypoint_UnknownIsNotFound(t *testing.T) {
	svc, _, _ := newServiceWithRoute(t)

	_, err := svc.DeleteWaypoint(context.Background(), "0123456789abcdef0123456789abcdef")

	require.ErrorIs(t, err, apperr.ErrNotFound)
}

func TestService_UpdateWaypoint_AppliesOnlyProvidedFields(t *testing.T) {
	svc, _, route := newServiceWithRoute(t)
	original := addWaypoints(t, svc, route.ID, "Kandy")[0]
	newRadius := 120

	updated, err := svc.UpdateWaypoint(context.Background(), original.ID, UpdateWaypointInput{BoundaryRadiusM: &newRadius})

	require.NoError(t, err)
	require.Equal(t, 120, updated.BoundaryRadiusM)
	require.Equal(t, "Kandy", updated.Label)
	require.InDelta(t, original.Lat, updated.Lat, 1e-9)
}

func TestService_UpdateWaypoint_ValidatesNewValues(t *testing.T) {
	svc, _, route := newServiceWithRoute(t)
	original := addWaypoints(t, svc, route.ID, "Kandy")[0]
	badLat := 100.0

	_, err := svc.UpdateWaypoint(context.Background(), original.ID, UpdateWaypointInput{Lat: &badLat})

	require.ErrorIs(t, err, apperr.ErrValidation)
}

func TestService_AttachTasks_IsIdempotentAndDeduplicates(t *testing.T) {
	svc, _, route := newServiceWithRoute(t)
	waypoint := addWaypoints(t, svc, route.ID, "Kandy")[0]
	taskA, taskB := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	ctx := context.Background()

	require.NoError(t, svc.AttachTasks(ctx, waypoint.ID, []string{taskA, taskB, taskA}))
	require.NoError(t, svc.AttachTasks(ctx, waypoint.ID, []string{taskA, taskB}))

	got, err := svc.GetRoute(ctx, route.ID)
	require.NoError(t, err)
	require.Equal(t, []string{taskA, taskB}, got.Waypoints[0].TaskIDs)
}

func TestService_AttachTasks_UnknownWaypointIsNotFound(t *testing.T) {
	svc := NewService(newFakeRepo())

	err := svc.AttachTasks(context.Background(), "missing", []string{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"})

	require.ErrorIs(t, err, ErrWaypointNotFound)
}

// Detaching everything is how the organizer clears a waypoint's tasks.
func TestService_AttachTasks_EmptyListClearsAttachments(t *testing.T) {
	svc, _, route := newServiceWithRoute(t)
	waypoint := addWaypoints(t, svc, route.ID, "Kandy")[0]
	ctx := context.Background()
	require.NoError(t, svc.AttachTasks(ctx, waypoint.ID, []string{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}))

	require.NoError(t, svc.AttachTasks(ctx, waypoint.ID, nil))

	got, err := svc.GetRoute(ctx, route.ID)
	require.NoError(t, err)
	require.Empty(t, got.Waypoints[0].TaskIDs)
}

func TestService_ListRoutes(t *testing.T) {
	svc, _, _ := newServiceWithRoute(t)
	_, err := svc.CreateRoute(context.Background(), CreateRouteInput{EventID: eventID, Name: "Wetlands", Order: 1})
	require.NoError(t, err)

	got, err := svc.ListRoutes(context.Background(), eventID)

	require.NoError(t, err)
	require.Len(t, got, 2)
	require.Equal(t, "Inland", got[0].Name)
	require.Equal(t, "Wetlands", got[1].Name)
}
