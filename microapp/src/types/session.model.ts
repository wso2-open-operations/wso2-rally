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
 * What screens work with: typed, `Date` rather than strings, absent values as
 * `null`. Built from the wire shapes in `session.dto.ts` by the mappers in
 * `services/session.ts`.
 */

import type { CrewAlertTypeDTO, SessionStatusDTO } from "@/types/session.dto";

export type SessionStatus = SessionStatusDTO;

export interface SessionModel {
  id: string;
  eventId: string;
  vehicleId: string;
  status: SessionStatus;
  currentWaypointId: string | null;
  totalScore: number;
  boundAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastLat: number | null;
  lastLng: number | null;
}

export interface Circle {
  lat: number;
  lng: number;
  radiusM: number;
  /** False until the organizer has dropped the pin; such a circle is not drawn. */
  placed: boolean;
}

export interface Waypoint {
  id: string;
  order: number;
  circle: Circle;
  taskIds: string[];
}

export interface Device {
  id: string;
  crewMemberId: string;
  crewMemberName: string;
  joinedAt: Date;
  lastSeenAt: Date | null;
  sharing: boolean;
}

export interface SessionState {
  session: SessionModel;
  vehicleCode: string;
  teamName: string;
  eventStatus: string;
  startTime: string;
  /** Count down to this. Null when the event's start cannot be read. */
  startsAt: Date | null;
  /** Null until the start has passed. */
  cipher: string | null;
  startCircle: Circle;
  finishCircle: Circle;
  waypoints: Waypoint[];
  /** Null once every waypoint is behind the car. */
  nextWaypointId: string | null;
  crew: Device[];
  you: Device;
  sharingCount: number;
  coverageLost: boolean;
}

export interface JoinResult {
  token: string;
  session: SessionModel;
  device: Device;
  crew: Device[];
}

export interface PingEvent {
  type: string;
  waypointId: string | null;
  taskId: string | null;
}

export interface PingResult {
  unlockedTaskIds: string[];
  currentWaypointId: string | null;
  arrived: boolean;
  events: PingEvent[];
}

/** A position to report. `takenAt` is required for a buffered fix and omitted for a live one. */
export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  takenAt?: Date;
}

export interface SubmitResult {
  correct: boolean;
  awardedPoints: number;
  detail: string;
}

export interface Voucher {
  entryCode: string;
  lockerId: string;
  lunchPasses: number;
}

export type CrewAlertType = CrewAlertTypeDTO;

export interface CrewAlertInput {
  type: CrewAlertType;
  note: string;
  lat?: number | null;
  lng?: number | null;
}

export interface CrewAlert {
  id: string;
  type: CrewAlertType;
  note: string;
  raisedAt: Date;
}
