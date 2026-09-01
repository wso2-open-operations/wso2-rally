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
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { useEffect, useMemo, useState, type JSX } from "react";
import { useSearchParams } from "react-router";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Skeleton,
  Typography,
} from "@wso2/oxygen-ui";
import { Plus } from "@wso2/oxygen-ui-icons-react";
import EventSelect from "@components/event-select/EventSelect";
import AddRouteDialog from "@features/routes/components/AddRouteDialog";
import RouteMap from "@features/routes/components/RouteMap";
import RouteTabs from "@features/routes/components/RouteTabs";
import WaypointDialog from "@features/routes/components/WaypointDialog";
import WaypointList from "@features/routes/components/WaypointList";
import { useGetRoute } from "@features/routes/api/useGetRoute";
import { useListRoutes } from "@features/routes/api/useListRoutes";
import {
  useAddWaypoint,
  useAttachTasks,
  useCreateRoute,
  useDeleteWaypoint,
  useReorderWaypoints,
  useUpdateWaypoint,
} from "@features/routes/api/useRouteMutations";
import { useSearchTasks } from "@features/tasks/api/useSearchTasks";
import { useEventSelection } from "@hooks/useEventSelection";
import { useErrorBanner } from "@context/error-banner/useErrorBanner";
import { useSuccessBanner } from "@context/success-banner/useSuccessBanner";
import { getApiErrorMessage } from "@utils/ApiError";
import {
  DEFAULT_BOUNDARY_RADIUS_M,
  type AddWaypointRequest,
  type Waypoint,
} from "@/types/route";

/** Query parameter carrying the open route, so a page is linkable and reloadable. */
const ROUTE_ID_PARAM = "routeId";

/** The blank waypoint the "+ Waypoint" button opens the dialog with. */
const newWaypoint = (routeId: string): Waypoint => ({
  id: "",
  routeId,
  order: 0,
  label: "",
  lat: 0,
  lng: 0,
  boundaryRadiusM: DEFAULT_BOUNDARY_RADIUS_M,
  taskIds: [],
});

/**
 * A3 — routes and geofences.
 *
 * The waypoint order, each leg's boundary radius, and which tasks unlock inside
 * it are all authored here; the backend evaluates every one of them server-side
 * during the run, so this page is editing scoring parameters, not a drawing.
 *
 * @returns {JSX.Element} The routes page.
 */
export default function RoutesPage(): JSX.Element {
  const { showError } = useErrorBanner();
  const { showSuccess } = useSuccessBanner();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    events,
    selectedEvent,
    selectedEventId,
    selectEvent,
    isLoading: isEventsLoading,
    error: eventsError,
  } = useEventSelection();

  const {
    data: routes,
    error: routesError,
    isLoading: isRoutesLoading,
  } = useListRoutes(selectedEventId);

  const requestedRouteId = searchParams.get(ROUTE_ID_PARAM) ?? undefined;
  const selectedRoute = useMemo(() => {
    const available = routes ?? [];

    // A stale id — from another event, or a hand-edited link — falls back to
    // the event's first route rather than showing an empty editor.
    return available.find((route) => route.id === requestedRouteId) ?? available[0];
  }, [routes, requestedRouteId]);
  const selectedRouteId = selectedRoute?.id;

  const { data: route, error: routeError, isLoading: isRouteLoading } =
    useGetRoute(selectedRouteId);
  const { data: taskPage, error: tasksError } = useSearchTasks(selectedEventId);

  const createRoute = useCreateRoute();
  const addWaypoint = useAddWaypoint();
  const updateWaypoint = useUpdateWaypoint();
  const deleteWaypoint = useDeleteWaypoint();
  const reorderWaypoints = useReorderWaypoints();
  const attachTasks = useAttachTasks();

  const [openWaypointId, setOpenWaypointId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Waypoint | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Waypoint | null>(null);
  const [isAddingRoute, setIsAddingRoute] = useState(false);

  const waypoints = route?.waypoints ?? [];
  const tasks = taskPage?.items ?? [];

  // Derived rather than reset: switching route or deleting the open leg leaves
  // an id that is no longer on this route, and treating that as "nothing open"
  // needs no effect to chase the change.
  const expandedId =
    openWaypointId !== null && waypoints.some((point) => point.id === openWaypointId)
      ? openWaypointId
      : null;
  const loadError = eventsError ?? routesError ?? routeError ?? tasksError;

  const isBusy =
    addWaypoint.isPending ||
    updateWaypoint.isPending ||
    deleteWaypoint.isPending ||
    reorderWaypoints.isPending ||
    attachTasks.isPending;

  useEffect(() => {
    if (loadError) {
      showError(getApiErrorMessage(loadError) ?? "Could not load this event's routes.");
    }
  }, [loadError, showError]);

  const selectRoute = (routeId: string): void => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(ROUTE_ID_PARAM, routeId);

        return next;
      },
      { replace: true },
    );
  };

  const onMutationError = (fallback: string) => (error: Error) =>
    showError(getApiErrorMessage(error) ?? fallback);

  const handleSaveWaypoint = (body: AddWaypointRequest): void => {
    if (!editing || !selectedRouteId) return;

    if (editing.id === "") {
      addWaypoint.mutate(
        { routeId: selectedRouteId, body },
        {
          onSuccess: (created) => {
            showSuccess(`${created.label} added to ${route?.name ?? "the route"}.`);
            setEditing(null);
          },
          onError: onMutationError("Could not add the waypoint."),
        },
      );

      return;
    }

    updateWaypoint.mutate(
      { waypointId: editing.id, routeId: selectedRouteId, body },
      {
        onSuccess: () => {
          showSuccess(`${body.label} saved.`);
          setEditing(null);
        },
        onError: onMutationError("Could not save the waypoint."),
      },
    );
  };

  const handleDelete = (): void => {
    if (!pendingDelete || !selectedRouteId) return;

    deleteWaypoint.mutate(
      { waypointId: pendingDelete.id, routeId: selectedRouteId },
      {
        onSuccess: () => {
          showSuccess(`${pendingDelete.label} removed.`);
          // The open panel closes on its own: expandedId is derived from the
          // refetched waypoints, which no longer contain this id.
          setPendingDelete(null);
        },
        onError: onMutationError("Could not remove the waypoint."),
      },
    );
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
      <Box sx={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        <Typography variant="h5">Routes &amp; geofences</Typography>
        <Box sx={{ flex: 1 }} />
        <EventSelect
          events={events}
          isLoading={isEventsLoading}
          onChange={selectEvent}
          selectedEventId={selectedEventId}
        />
        <Button
          disabled={!selectedEventId || createRoute.isPending}
          onClick={() => setIsAddingRoute(true)}
          startIcon={<Plus size={16} />}
          type="button"
          variant="outlined"
        >
          Route
        </Button>
      </Box>

      <RouteTabs
        isLoading={isEventsLoading || isRoutesLoading}
        onSelect={selectRoute}
        routes={routes ?? []}
        selectedRouteId={selectedRouteId}
      />

      {!isRoutesLoading && (routes ?? []).length === 0 ? (
        <Paper sx={{ p: 3 }} variant="outlined">
          <Typography color="text.secondary" variant="body2">
            This event has no routes yet. Add one — the rally runs two, Inland
            and Wetlands — then place the waypoints each of them drives through.
          </Typography>
        </Paper>
      ) : (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              flex: "1 1 260px",
              maxWidth: { md: 320 },
              minWidth: 260,
            }}
          >
            <Typography color="text.secondary" variant="caption">
              Waypoints · reorder with the arrows
            </Typography>

            {isRouteLoading ? (
              <Skeleton height={220} variant="rounded" />
            ) : (
              <WaypointList
                expandedId={expandedId}
                isBusy={isBusy}
                onAttachTasks={(waypointId, taskIds) =>
                  attachTasks.mutate(
                    { waypointId, routeId: selectedRouteId ?? "", taskIds },
                    { onError: onMutationError("Could not update this waypoint's tasks.") },
                  )
                }
                onDelete={setPendingDelete}
                onEdit={setEditing}
                onExpand={setOpenWaypointId}
                onRadiusChange={(waypointId, radiusM) =>
                  updateWaypoint.mutate(
                    {
                      waypointId,
                      routeId: selectedRouteId ?? "",
                      body: { boundaryRadiusM: radiusM },
                    },
                    { onError: onMutationError("Could not change the boundary radius.") },
                  )
                }
                onReorder={(orderedIds) =>
                  reorderWaypoints.mutate(
                    { routeId: selectedRouteId ?? "", orderedIds },
                    { onError: onMutationError("Could not reorder the waypoints.") },
                  )
                }
                tasks={tasks}
                waypoints={waypoints}
              />
            )}

            <Button
              disabled={!selectedRouteId || isBusy}
              onClick={() => setEditing(newWaypoint(selectedRouteId ?? ""))}
              startIcon={<Plus size={16} />}
              type="button"
              variant="outlined"
            >
              Waypoint
            </Button>
          </Box>

          <RouteMap
            end={selectedEvent?.end}
            onSelect={setOpenWaypointId}
            selectedId={expandedId}
            start={selectedEvent?.start}
            waypoints={waypoints}
          />
        </Box>
      )}

      <Typography color="text.secondary" variant="caption">
        Geofences are evaluated server-side: a car's reported position is checked
        against these radii, and crossing one is what unlocks the tasks attached
        to that waypoint.
      </Typography>

      <AddRouteDialog
        isSaving={createRoute.isPending}
        onClose={() => setIsAddingRoute(false)}
        onSave={(name) =>
          createRoute.mutate(
            {
              eventId: selectedEventId ?? "",
              body: { name, order: (routes ?? []).length },
            },
            {
              onSuccess: (created) => {
                showSuccess(`Route ${created.name} added.`);
                setIsAddingRoute(false);
                selectRoute(created.id);
              },
              onError: onMutationError("Could not add the route."),
            },
          )
        }
        open={isAddingRoute}
      />

      <WaypointDialog
        isSaving={addWaypoint.isPending || updateWaypoint.isPending}
        onClose={() => setEditing(null)}
        onSave={handleSaveWaypoint}
        waypoint={editing}
      />

      <Dialog onClose={() => setPendingDelete(null)} open={pendingDelete !== null}>
        <DialogTitle>Remove {pendingDelete?.label}?</DialogTitle>
        <DialogContent>
          <DialogContentText variant="body2">
            The waypoint, its geofence and its task attachments go with it, and
            the legs after it move up one place. Tasks themselves stay in the
            library.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={deleteWaypoint.isPending}
            onClick={() => setPendingDelete(null)}
            type="button"
          >
            Cancel
          </Button>
          <Button
            color="error"
            disabled={deleteWaypoint.isPending}
            onClick={handleDelete}
            type="button"
            variant="contained"
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
