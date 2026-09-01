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

/**
 * One leg of a course. Mirrors the backend `WaypointDTO`.
 *
 * `boundaryRadiusM` is the geofence the server evaluates a car's position
 * against — it is what unlocks the tasks attached here, so it is a scoring
 * parameter, not a map decoration.
 */
export interface Waypoint {
  id: string;
  routeId: string;
  /** Position in the driving sequence, 0-based and always gap-free. */
  order: number;
  label: string;
  lat: number;
  lng: number;
  boundaryRadiusM: number;
  /** Ids of the tasks that unlock inside this geofence. */
  taskIds: string[];
}

/** A named course through an event. Mirrors the backend `RouteDTO`. */
export interface RallyRoute {
  id: string;
  eventId: string;
  name: string;
  order: number;
  /** Present on `GET /routes/{id}`; omitted by the list endpoint. */
  waypoints?: Waypoint[];
}

/** `POST /events/{eventId}/routes` body. */
export interface CreateRouteRequest {
  name: string;
  order: number;
}

/** `POST /routes/{routeId}/waypoints` body. */
export interface AddWaypointRequest {
  label: string;
  lat: number;
  lng: number;
  boundaryRadiusM: number;
}

/** `PATCH /waypoints/{waypointId}` body — an omitted field is left unchanged. */
export type UpdateWaypointRequest = Partial<AddWaypointRequest>;

/**
 * `PATCH /routes/{routeId}/waypoints/order` body.
 *
 * The backend rejects anything that is not a permutation of the route's current
 * waypoints, so this must always be the complete list.
 */
export interface ReorderWaypointsRequest {
  orderedIds: string[];
}

/** `POST /waypoints/{waypointId}/tasks` body — replaces the whole attachment set. */
export interface AttachTasksRequest {
  taskIds: string[];
}

/** The radius a new waypoint starts at, in metres. */
export const DEFAULT_BOUNDARY_RADIUS_M = 50;

/**
 * Returns `ids` with the entry at `index` swapped one place towards the start.
 * Returns the list unchanged when it is already first.
 *
 * @param {string[]} ids - The current order.
 * @param {number} index - Position of the entry to move.
 * @returns {string[]} The reordered ids.
 */
export function movedUp(ids: string[], index: number): string[] {
  if (index <= 0 || index >= ids.length) {
    return ids;
  }

  const next = [...ids];
  [next[index - 1], next[index]] = [next[index], next[index - 1]];

  return next;
}

/**
 * Returns `ids` with the entry at `index` swapped one place towards the end.
 * Returns the list unchanged when it is already last.
 *
 * @param {string[]} ids - The current order.
 * @param {number} index - Position of the entry to move.
 * @returns {string[]} The reordered ids.
 */
export function movedDown(ids: string[], index: number): string[] {
  if (index < 0 || index >= ids.length - 1) {
    return ids;
  }

  const next = [...ids];
  [next[index], next[index + 1]] = [next[index + 1], next[index]];

  return next;
}
