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
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/storetest"
)

// seedEvent inserts the parent row the route foreign key needs.
func seedEvent(t *testing.T, db *sql.DB) string {
	t.Helper()

	id := store.NewID()
	_, err := db.Exec(
		"INSERT INTO event (id, name, event_date, start_time, created_by) VALUES (?, 'Rally', '2027-02-13', '09:00', 'u')",
		id)
	require.NoError(t, err)

	return id
}

// seedTask inserts a task row so waypoint_task attachments satisfy their
// foreign key.
func seedTask(t *testing.T, db *sql.DB, eventID, code string) string {
	t.Helper()

	id := store.NewID()
	_, err := db.Exec(
		"INSERT INTO task (id, event_id, code, title, type, `trigger`, points, config) "+
			"VALUES (?, ?, ?, 'Task', 'INPUT_SELECT', 'geofence', 50, '{}')",
		id, eventID, code)
	require.NoError(t, err)

	return id
}

func newRepoWithRoute(t *testing.T) (*sql.DB, Repo, Route) {
	t.Helper()

	db := storetest.DB(t)
	repo := NewRepo(db)
	route, err := NewService(repo).CreateRoute(context.Background(), CreateRouteInput{
		EventID: seedEvent(t, db), Name: "Inland",
	})
	require.NoError(t, err)

	return db, repo, route
}

func TestRepo_RouteRoundTrip(t *testing.T) {
	_, repo, created := newRepoWithRoute(t)

	got, err := repo.GetRoute(context.Background(), created.ID)

	require.NoError(t, err)
	require.Equal(t, created.Name, got.Name)
	require.Equal(t, created.EventID, got.EventID)
}

func TestRepo_CreateRoute_DuplicateNameInSameEvent(t *testing.T) {
	db := storetest.DB(t)
	repo := NewRepo(db)
	svc := NewService(repo)
	eventID := seedEvent(t, db)
	ctx := context.Background()
	_, err := svc.CreateRoute(ctx, CreateRouteInput{EventID: eventID, Name: "Inland"})
	require.NoError(t, err)

	_, err = svc.CreateRoute(ctx, CreateRouteInput{EventID: eventID, Name: "Inland"})

	require.ErrorIs(t, err, ErrDuplicateName)
	require.ErrorIs(t, err, apperr.ErrConflict)
}

func TestRepo_GetRoute_UnknownIsNotFound(t *testing.T) {
	repo := NewRepo(storetest.DB(t))

	_, err := repo.GetRoute(context.Background(), store.NewID())

	require.ErrorIs(t, err, ErrRouteNotFound)
}

func TestRepo_ReorderWaypoints_PersistsNewOrder(t *testing.T) {
	_, repo, route := newRepoWithRoute(t)
	svc := NewService(repo)
	ctx := context.Background()
	added := addWaypoints(t, svc, route.ID, "a", "b", "c")
	a, b, c := added[0].ID, added[1].ID, added[2].ID

	require.NoError(t, svc.ReorderWaypoints(ctx, route.ID, []string{c, a, b}))

	got, err := svc.GetRoute(ctx, route.ID)
	require.NoError(t, err)
	require.Equal(t, []string{"c", "a", "b"}, []string{
		got.Waypoints[0].Label, got.Waypoints[1].Label, got.Waypoints[2].Label,
	})
	require.Equal(t, []int{0, 1, 2}, []int{
		got.Waypoints[0].Order, got.Waypoints[1].Order, got.Waypoints[2].Order,
	})
}

func TestRepo_AttachTasks_IsIdempotent(t *testing.T) {
	db, repo, route := newRepoWithRoute(t)
	svc := NewService(repo)
	ctx := context.Background()
	waypoint := addWaypoints(t, svc, route.ID, "Kandy")[0]
	taskA := seedTask(t, db, route.EventID, "T1")
	taskB := seedTask(t, db, route.EventID, "T2")

	require.NoError(t, svc.AttachTasks(ctx, waypoint.ID, []string{taskA, taskB}))
	require.NoError(t, svc.AttachTasks(ctx, waypoint.ID, []string{taskA, taskB}))

	var rowCount int
	require.NoError(t, db.QueryRow(
		"SELECT COUNT(*) FROM waypoint_task WHERE waypoint_id = ?", waypoint.ID).Scan(&rowCount))
	require.Equal(t, 2, rowCount, "re-attaching the same tasks must not duplicate rows")

	got, err := repo.GetWaypoint(ctx, waypoint.ID)
	require.NoError(t, err)
	require.Equal(t, []string{taskA, taskB}, got.TaskIDs)
}

func TestRepo_AttachTasks_ReplacesPreviousSet(t *testing.T) {
	db, repo, route := newRepoWithRoute(t)
	svc := NewService(repo)
	ctx := context.Background()
	waypoint := addWaypoints(t, svc, route.ID, "Kandy")[0]
	taskA := seedTask(t, db, route.EventID, "T1")
	taskB := seedTask(t, db, route.EventID, "T2")
	require.NoError(t, svc.AttachTasks(ctx, waypoint.ID, []string{taskA}))

	require.NoError(t, svc.AttachTasks(ctx, waypoint.ID, []string{taskB}))

	got, err := repo.GetWaypoint(ctx, waypoint.ID)
	require.NoError(t, err)
	require.Equal(t, []string{taskB}, got.TaskIDs)
}

func TestRepo_ListWaypoints_CarriesTaskIDsPerWaypoint(t *testing.T) {
	db, repo, route := newRepoWithRoute(t)
	svc := NewService(repo)
	ctx := context.Background()
	added := addWaypoints(t, svc, route.ID, "first", "second")
	taskA := seedTask(t, db, route.EventID, "T1")
	require.NoError(t, svc.AttachTasks(ctx, added[0].ID, []string{taskA}))

	got, err := repo.ListWaypoints(ctx, route.ID)

	require.NoError(t, err)
	require.Len(t, got, 2)
	require.Equal(t, []string{taskA}, got[0].TaskIDs)
	require.Empty(t, got[1].TaskIDs)
}

func TestRepo_UpdateWaypoint_UnknownIsNotFound(t *testing.T) {
	repo := NewRepo(storetest.DB(t))

	err := repo.UpdateWaypoint(context.Background(), Waypoint{ID: store.NewID(), Label: "x", BoundaryRadiusM: 10})

	require.ErrorIs(t, err, ErrWaypointNotFound)
}

func TestRepo_DeleteWaypoint_RenumbersTheRemainder(t *testing.T) {
	_, repo, route := newRepoWithRoute(t)
	svc := NewService(repo)
	ctx := context.Background()
	added := addWaypoints(t, svc, route.ID, "a", "b", "c", "d")

	got, err := svc.DeleteWaypoint(ctx, added[1].ID)

	require.NoError(t, err)
	require.Equal(t, []string{"a", "c", "d"}, []string{
		got.Waypoints[0].Label, got.Waypoints[1].Label, got.Waypoints[2].Label,
	})
	require.Equal(t, []int{0, 1, 2}, []int{
		got.Waypoints[0].Order, got.Waypoints[1].Order, got.Waypoints[2].Order,
	})
}

func TestRepo_DeleteWaypoint_TakesItsAttachmentsWithIt(t *testing.T) {
	db, repo, route := newRepoWithRoute(t)
	svc := NewService(repo)
	ctx := context.Background()
	waypoint := addWaypoints(t, svc, route.ID, "Kandy")[0]
	require.NoError(t, svc.AttachTasks(ctx, waypoint.ID, []string{seedTask(t, db, route.EventID, "T1")}))

	_, err := svc.DeleteWaypoint(ctx, waypoint.ID)
	require.NoError(t, err)

	var remaining int
	require.NoError(t, db.QueryRow(
		"SELECT COUNT(*) FROM waypoint_task WHERE waypoint_id = ?", waypoint.ID).Scan(&remaining))
	require.Zero(t, remaining, "the task attachment rows cascade with the waypoint")
}

func TestRepo_DeleteWaypoint_UnknownIsNotFound(t *testing.T) {
	_, repo, route := newRepoWithRoute(t)

	err := repo.DeleteWaypoint(context.Background(), route.ID, store.NewID())

	require.ErrorIs(t, err, ErrWaypointNotFound)
}

func TestRepo_DeletingARouteCascadesToWaypoints(t *testing.T) {
	db, repo, route := newRepoWithRoute(t)
	svc := NewService(repo)
	addWaypoints(t, svc, route.ID, "Kandy")

	_, err := db.Exec("DELETE FROM route WHERE id = ?", route.ID)
	require.NoError(t, err)

	var remaining int
	require.NoError(t, db.QueryRow("SELECT COUNT(*) FROM waypoint WHERE route_id = ?", route.ID).Scan(&remaining))
	require.Zero(t, remaining)
}
