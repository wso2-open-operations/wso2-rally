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

/**
 * Wire shapes of the in-car API, exactly as the backend sends them: string
 * dates, nullable fields. Mirrors `backend/internal/sessions/dto.go` and
 * `backend/api/openapi.yaml`. Screens never see these — `services/session.ts`
 * maps them to the models in `session.model.ts`.
 */

export type SessionStatusDTO = "bound" | "active" | "finished";

export interface SessionDTO {
  id: string;
  eventId: string;
  vehicleId: string;
  status: SessionStatusDTO;
  currentWaypointId: string | null;
  totalScore: number;
  boundAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastLat: number | null;
  lastLng: number | null;
}

/** A geofence. `placed` is false until the organizer has dropped the pin. */
export interface CircleDTO {
  lat: number;
  lng: number;
  radiusM: number;
  placed: boolean;
}

export interface WaypointDTO {
  id: string;
  order: number;
  circle: CircleDTO;
  taskIds: string[];
}

/** One phone in the car. */
export interface DeviceDTO {
  id: string;
  crewMemberId: string;
  crewMemberName: string;
  joinedAt: string;
  lastSeenAt: string | null;
  /** Reported in the last 90 seconds. */
  sharing: boolean;
}

/** `GET /sessions/me`. */
export interface SessionStateDTO {
  session: SessionDTO;
  vehicleCode: string;
  teamName: string;
  eventStatus: string;
  /** The wall-clock start as typed, "HH:MM". */
  startTime: string;
  /** The start as an instant; null when the event's start cannot be read. */
  startsAt: string | null;
  /** Empty until the event is active and `startsAt` has passed. */
  cipher: string;
  startCircle: CircleDTO;
  finishCircle: CircleDTO;
  waypoints: WaypointDTO[];
  nextWaypointId: string;
  crew: DeviceDTO[];
  you: DeviceDTO;
  sharingCount: number;
  /** No phone has reported for 30 s while the car is on the course. */
  coverageLost: boolean;
}

/** `POST /sessions/join` body. The caller's identity comes from the token, never the body. */
export interface JoinRequestDTO {
  vehicleId: string;
}

export interface JoinResponseDTO {
  teamToken: string;
  session: SessionDTO;
  device: DeviceDTO;
  crew: DeviceDTO[];
}

/** `POST /sessions/me/location` body. */
export interface LocationRequestDTO {
  lat: number;
  lng: number;
  accuracy: number;
  /** When the fix was taken, ISO 8601. Omit for a live fix; required for a buffered one. */
  ts?: string;
}

export interface PingEventDTO {
  type: string;
  waypointId?: string;
  taskId?: string;
}

export interface PingResponseDTO {
  unlockedTaskIds: string[];
  currentWaypointId: string;
  arrived: boolean;
  events: PingEventDTO[];
}

export interface SubmitResultDTO {
  correct: boolean;
  awardedPoints: number;
  detail: string;
}

export interface VoucherDTO {
  entryCode: string;
  lockerId: string;
  lunchPasses: number;
}

export type CrewAlertTypeDTO = "breakdown" | "device_issue" | "other";

/** `POST /sessions/me/alerts` body. */
export interface CrewAlertRequestDTO {
  type: CrewAlertTypeDTO;
  note: string;
  lat: number | null;
  lng: number | null;
}

/** The alert the backend raised, as `alerts.AlertDTO` sends it. */
export interface AlertDTO {
  id: string;
  vehicleId: string;
  type: CrewAlertTypeDTO;
  note: string;
  source: string;
  raisedAt: string;
  resolvedAt: string | null;
}
