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

import type { VehicleStatus } from "@/types/vehicle";

/** A vehicle's run state. Mirrors `sessions.Status`. */
export type SessionStatus = "bound" | "active" | "finished" | "";

/** One row of `GET /events/{id}/monitor`. Mirrors `VehicleProgressDTO`. */
export interface VehicleProgress {
  vehicleCode: string;
  teamName: string;
  status: VehicleStatus;
  sessionStatus: SessionStatus;
  /** Tasks answered correctly so far. */
  done: number;
  /** The size of this event's task library, so `done/totalTasks` is meaningful. */
  totalTasks: number;
  totalScore: number;
  lastLat: number | null;
  lastLng: number | null;
  lastSeenAt: string | null;
}

/** `GET /events/{id}/monitor`. Mirrors `MonitorSnapshotDTO`. */
export interface MonitorSnapshot {
  vehicles: VehicleProgress[];
  openAlerts: number;
}

/** A vehicle problem. Mirrors the backend `AlertDTO`. */
export interface RallyAlert {
  id: string;
  vehicleId: string;
  type: "breakdown" | "device_issue" | "other";
  note: string;
  source: string;
  raisedAt: string;
  /** Null while the alert is still open. */
  resolvedAt: string | null;
  lat?: number | null;
  lng?: number | null;
}

// ---------------------------------------------------------------------------
// WebSocket messages on `event:{id}` — see backend/api/asyncapi.yaml
// ---------------------------------------------------------------------------

export interface VehiclePositionMessage {
  type: "vehicle_position";
  vehicleCode: string;
  lat: number;
  lng: number;
}

export interface TaskCompletedMessage {
  type: "task_completed";
  vehicleCode: string;
  taskCode: string;
}

export interface ScoreDeltaMessage {
  type: "score_delta";
  vehicleCode: string;
  /** May be negative when a crew takes the BRANCH shortcut. */
  delta: number;
  /** The authoritative running score — trusted over adding up deltas. */
  total: number;
}

export interface AlertMessage {
  type: "alert";
  alert: RallyAlert;
}

/**
 * The recomputed standings, which the monitor ignores — A7 renders them.
 *
 * Modelled anyway so the reducer can recognise it and pass, rather than log an
 * unknown message every time a score changes.
 */
export interface LeaderboardMessage {
  type: "leaderboard";
  entries: unknown[];
}

/** Any message the organizer topic carries. */
export type MonitorMessage =
  | VehiclePositionMessage
  | TaskCompletedMessage
  | ScoreDeltaMessage
  | AlertMessage
  | LeaderboardMessage;
