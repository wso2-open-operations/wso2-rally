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
 * Frames the backend sends on `session:{id}`, exactly as they arrive. Mirrors
 * `backend/api/asyncapi.yaml` and the broadcasts in `internal/sessions`.
 *
 * The hub keeps no history and delivers best-effort, so every one of these is
 * also readable from `GET /sessions/me` (or the task list) for a phone that
 * missed it.
 */

/** The synchronised start. At least once: a repeat is the same start. */
export interface StartSignalFrame {
  type: "start_signal";
  startsAt: string;
}

/** Sent right after `start_signal`; not at all when the event has no cipher. */
export interface CipherRevealFrame {
  type: "cipher_reveal";
  cipher: string;
}

/** A phone's ping opened tasks; every phone in the car hears it. */
export interface TaskUnlockedFrame {
  type: "task_unlocked";
  taskIds: string[];
  currentWaypointId: string;
}

/** A teammate settled a task — right or wrong, it is closed for the car. */
export interface TaskCompletedFrame {
  type: "task_completed";
  taskId: string;
  taskCode: string;
  totalScore: number;
}

/** The car entered a mandatory rest stop. */
export interface RestLockFrame {
  type: "rest_lock";
  taskId: string;
}

/** A timed question just opened. */
export interface TriviaFrame {
  type: "trivia";
  taskId: string;
}

/** The car reached the finish; the run is over and the voucher issued. */
export interface ArrivalFrame {
  type: "arrival";
}

/** No phone in the car has reported for 30 s. */
export interface CoverageLostFrame {
  type: "coverage_lost";
  lastReportAt: string | null;
}

export interface CoverageRestoredFrame {
  type: "coverage_restored";
}

export type SessionFrame =
  | StartSignalFrame
  | CipherRevealFrame
  | TaskUnlockedFrame
  | TaskCompletedFrame
  | RestLockFrame
  | TriviaFrame
  | ArrivalFrame
  | CoverageLostFrame
  | CoverageRestoredFrame;
