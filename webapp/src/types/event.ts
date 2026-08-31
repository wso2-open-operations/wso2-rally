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

/** An event's lifecycle stage. Only `setup` events are editable. */
export type EventStatus = "setup" | "active" | "complete";

/**
 * A named circular geofence.
 *
 * `lat`/`lng` are nullable because an organizer saves an event before dropping
 * its pins — publishing is what requires both boundaries to be placed.
 */
export interface Boundary {
  label: string;
  lat: number | null;
  lng: number | null;
  radiusM: number;
}

/** One of the event's routes, as the events endpoints project it. */
export interface RouteRef {
  id: string;
  name: string;
}

/** Mirrors the backend `EventDTO`. */
export interface RallyEvent {
  id: string;
  name: string;
  /** Calendar date, `YYYY-MM-DD`. */
  eventDate: string;
  /** Local wall-clock start, `HH:MM`. */
  startTime: string;
  status: EventStatus;
  start: Boundary;
  end: Boundary;
  /** Revealed to every crew on the start signal. */
  cipher: string;
  createdBy: string;
  createdOn: string;
  routes: RouteRef[];
}

/** The headline counts behind the dashboard cards. */
export interface EventStats {
  vehicles: number;
  crews: number;
  tasks: number;
  openAlerts: number;
}

/** `POST /events` body. */
export interface CreateEventRequest {
  name: string;
  eventDate: string;
  startTime: string;
  start: Boundary;
  end: Boundary;
  cipher: string;
}

/** `PATCH /events/{id}` body — an omitted field is left unchanged. */
export type UpdateEventRequest = Partial<CreateEventRequest>;

/** `POST /events/search` body. */
export interface SearchEventsRequest {
  offset: number;
  limit: number;
  filters: {
    status?: EventStatus | "";
  };
}

export const EMPTY_BOUNDARY: Boundary = {
  label: "",
  lat: null,
  lng: null,
  radiusM: 0,
};

/** True once the boundary has coordinates and can be evaluated server-side. */
export function isBoundaryPlaced(boundary: Boundary): boolean {
  return boundary.lat !== null && boundary.lng !== null;
}
