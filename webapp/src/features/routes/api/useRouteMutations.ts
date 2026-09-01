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

import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useAuthApiClient } from "@hooks/useAuthApiClient";
import { ApiQueryKeys } from "@constants/apiConstants";
import type {
  AddWaypointRequest,
  CreateRouteRequest,
  RallyRoute,
  UpdateWaypointRequest,
  Waypoint,
} from "@/types/route";

/**
 * Drops the cached copy of a route.
 *
 * Every waypoint mutation is refetched rather than patched into the cache: the
 * server owns `order`, and add, delete and reorder all renumber siblings the
 * response for a single waypoint does not mention.
 */
function invalidateRoute(queryClient: QueryClient, routeId: string): void {
  void queryClient.invalidateQueries({
    queryKey: [ApiQueryKeys.ROUTES, "detail", routeId],
  });
}

export interface CreateRouteVariables {
  eventId: string;
  body: CreateRouteRequest;
}

/**
 * Adds a course to an event. A duplicate name within the event is a 409.
 *
 * @returns {UseMutationResult<RallyRoute, Error, CreateRouteVariables>} The create mutation.
 */
export function useCreateRoute(): UseMutationResult<
  RallyRoute,
  Error,
  CreateRouteVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<RallyRoute, Error, CreateRouteVariables>({
    mutationFn: ({ eventId, body }) =>
      authJson<RallyRoute>(`/events/${eventId}/routes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_route, { eventId }) => {
      void queryClient.invalidateQueries({ queryKey: [ApiQueryKeys.ROUTES, eventId] });
    },
  });
}

export interface AddWaypointVariables {
  routeId: string;
  body: AddWaypointRequest;
}

/**
 * Appends a waypoint to the end of a route.
 *
 * @returns {UseMutationResult<Waypoint, Error, AddWaypointVariables>} The add mutation.
 */
export function useAddWaypoint(): UseMutationResult<
  Waypoint,
  Error,
  AddWaypointVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<Waypoint, Error, AddWaypointVariables>({
    mutationFn: ({ routeId, body }) =>
      authJson<Waypoint>(`/routes/${routeId}/waypoints`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_waypoint, { routeId }) => invalidateRoute(queryClient, routeId),
  });
}

export interface UpdateWaypointVariables {
  waypointId: string;
  /** Carried only to invalidate the right route; the path uses the waypoint id. */
  routeId: string;
  body: UpdateWaypointRequest;
}

/**
 * Moves, renames or re-sizes one waypoint.
 *
 * @returns {UseMutationResult<Waypoint, Error, UpdateWaypointVariables>} The update mutation.
 */
export function useUpdateWaypoint(): UseMutationResult<
  Waypoint,
  Error,
  UpdateWaypointVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<Waypoint, Error, UpdateWaypointVariables>({
    mutationFn: ({ waypointId, body }) =>
      authJson<Waypoint>(`/waypoints/${waypointId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (_waypoint, { routeId }) => invalidateRoute(queryClient, routeId),
  });
}

export interface DeleteWaypointVariables {
  waypointId: string;
  routeId: string;
}

/**
 * Removes a waypoint. The backend renumbers what is left and returns the whole
 * route, because every leg after the deleted one has just moved up.
 *
 * @returns {UseMutationResult<RallyRoute, Error, DeleteWaypointVariables>} The delete mutation.
 */
export function useDeleteWaypoint(): UseMutationResult<
  RallyRoute,
  Error,
  DeleteWaypointVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<RallyRoute, Error, DeleteWaypointVariables>({
    mutationFn: ({ waypointId }) =>
      authJson<RallyRoute>(`/waypoints/${waypointId}`, { method: "DELETE" }),
    onSuccess: (_route, { routeId }) => invalidateRoute(queryClient, routeId),
  });
}

export interface ReorderWaypointsVariables {
  routeId: string;
  /** Must name every waypoint on the route; the backend rejects a partial list. */
  orderedIds: string[];
}

/**
 * Rewrites the leg sequence of a route.
 *
 * @returns {UseMutationResult<RallyRoute, Error, ReorderWaypointsVariables>} The reorder mutation.
 */
export function useReorderWaypoints(): UseMutationResult<
  RallyRoute,
  Error,
  ReorderWaypointsVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<RallyRoute, Error, ReorderWaypointsVariables>({
    mutationFn: ({ routeId, orderedIds }) =>
      authJson<RallyRoute>(`/routes/${routeId}/waypoints/order`, {
        method: "PATCH",
        body: JSON.stringify({ orderedIds }),
      }),
    onSuccess: (_route, { routeId }) => invalidateRoute(queryClient, routeId),
  });
}

export interface AttachTasksVariables {
  waypointId: string;
  routeId: string;
  /** The complete set for this waypoint — an empty list detaches everything. */
  taskIds: string[];
}

/**
 * Replaces the tasks bound to a waypoint.
 *
 * @returns {UseMutationResult<Waypoint, Error, AttachTasksVariables>} The attach mutation.
 */
export function useAttachTasks(): UseMutationResult<
  Waypoint,
  Error,
  AttachTasksVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<Waypoint, Error, AttachTasksVariables>({
    mutationFn: ({ waypointId, taskIds }) =>
      authJson<Waypoint>(`/waypoints/${waypointId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ taskIds }),
      }),
    onSuccess: (_waypoint, { routeId }) => invalidateRoute(queryClient, routeId),
  });
}
