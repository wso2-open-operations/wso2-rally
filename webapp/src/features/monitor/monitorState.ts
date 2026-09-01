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

import type {
  MonitorMessage,
  MonitorSnapshot,
  RallyAlert,
  VehicleProgress,
} from "@/types/monitor";

/** How many alerts the strip keeps. Older ones live in A1's alerts card. */
const ALERT_HISTORY = 20;

/** One vehicle as the monitor knows it: the snapshot, moved on by live messages. */
export interface VehicleLive extends Omit<VehicleProgress, "lastLat" | "lastLng"> {
  lat: number | null;
  lng: number | null;
}

export interface MonitorState {
  /** Keyed by vehicle code, which is what every live message identifies. */
  vehicles: Record<string, VehicleLive>;
  /** Newest first. */
  alerts: RallyAlert[];
  openAlerts: number;
}

/** The state before a snapshot has loaded. */
export function emptyMonitorState(): MonitorState {
  return { vehicles: {}, alerts: [], openAlerts: 0 };
}

/**
 * Seeds the live state from `GET /events/{id}/monitor`.
 *
 * The socket carries deltas, not state, so a monitor opened mid-rally would
 * otherwise show nothing until each car happened to move.
 *
 * @param {MonitorSnapshot} snapshot - The REST snapshot.
 * @returns {MonitorState} The seeded state.
 */
export function fromSnapshot(snapshot: MonitorSnapshot): MonitorState {
  const vehicles: Record<string, VehicleLive> = {};
  for (const vehicle of snapshot.vehicles) {
    const { lastLat, lastLng, ...rest } = vehicle;
    vehicles[vehicle.vehicleCode] = { ...rest, lat: lastLat, lng: lastLng };
  }

  return { vehicles, alerts: [], openAlerts: snapshot.openAlerts };
}

/** A vehicle the snapshot did not mention — bound after it was taken. */
const adopted = (vehicleCode: string): VehicleLive => ({
  vehicleCode,
  teamName: "",
  status: "ok",
  sessionStatus: "active",
  done: 0,
  totalTasks: 0,
  totalScore: 0,
  lat: null,
  lng: null,
  lastSeenAt: null,
});

/**
 * Folds one live message into the monitor's state.
 *
 * Pure and total: an unmodelled message returns the same state object, so React
 * skips the re-render, and nothing here can throw on malformed input — the
 * frames are parsed and validated by `parseMonitorMessage` first.
 *
 * @param {MonitorState} state - The current state.
 * @param {MonitorMessage} message - The message to apply.
 * @returns {MonitorState} The next state.
 */
export function monitorReducer(
  state: MonitorState,
  message: MonitorMessage,
): MonitorState {
  switch (message.type) {
    case "vehicle_position": {
      const previous = state.vehicles[message.vehicleCode] ?? adopted(message.vehicleCode);

      return {
        ...state,
        vehicles: {
          ...state.vehicles,
          [message.vehicleCode]: { ...previous, lat: message.lat, lng: message.lng },
        },
      };
    }

    case "task_completed": {
      const previous = state.vehicles[message.vehicleCode] ?? adopted(message.vehicleCode);
      // Counting up is a live estimate; the snapshot is authoritative. Cap it at
      // the library size so a duplicate frame cannot show 16/15.
      const done =
        previous.totalTasks > 0
          ? Math.min(previous.done + 1, previous.totalTasks)
          : previous.done + 1;

      return {
        ...state,
        vehicles: {
          ...state.vehicles,
          [message.vehicleCode]: { ...previous, done },
        },
      };
    }

    case "score_delta": {
      const previous = state.vehicles[message.vehicleCode] ?? adopted(message.vehicleCode);

      return {
        ...state,
        vehicles: {
          ...state.vehicles,
          // `total` is authoritative: summing deltas would drift permanently
          // the first time a frame is dropped, and dropping is by design.
          [message.vehicleCode]: { ...previous, totalScore: message.total },
        },
      };
    }

    case "alert": {
      // The same message carries a raise and a resolve, so replace by id rather
      // than listing one alert twice.
      const others = state.alerts.filter((alert) => alert.id !== message.alert.id);
      const alerts = [message.alert, ...others].slice(0, ALERT_HISTORY);

      return {
        ...state,
        alerts,
        openAlerts: countOpen(state, message.alert),
      };
    }

    default:
      // Same object, not a copy: the leaderboard message arrives on this topic
      // after every score change, and re-rendering the map for it is waste.
      return state;
  }
}

/**
 * Adjusts the open-alert badge for one alert.
 *
 * The snapshot's count is the baseline, so this moves it by one rather than
 * recounting `state.alerts` — which holds only what arrived since the page
 * opened and would undercount a rally already in progress.
 */
function countOpen(state: MonitorState, alert: RallyAlert): number {
  const known = state.alerts.find((previous) => previous.id === alert.id);
  const wasOpen = known ? known.resolvedAt === null : false;
  const isOpen = alert.resolvedAt === null;

  if (!known) {
    return isOpen ? state.openAlerts + 1 : state.openAlerts;
  }
  if (wasOpen && !isOpen) {
    return Math.max(0, state.openAlerts - 1);
  }
  if (!wasOpen && isOpen) {
    return state.openAlerts + 1;
  }

  return state.openAlerts;
}

/** The alert types the backend can send, mirroring the `alert_type` enum. */
const ALERT_TYPES = new Set(["breakdown", "device_issue", "other"]);

/**
 * Reports whether a frame's `alert` field is really an alert.
 *
 * Every other frame validates its fields before the cast; this one accepted any
 * non-null object, so a malformed frame reached the reducer and the alert strip
 * rendered undefined ids and types.
 *
 * @param {unknown} value - The candidate `message.alert`.
 * @returns {boolean} True when the field carries a usable alert.
 */
function isAlertPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const alert = value as Record<string, unknown>;

  return (
    typeof alert.id === "string" &&
    alert.id !== "" &&
    typeof alert.type === "string" &&
    ALERT_TYPES.has(alert.type) &&
    typeof alert.note === "string" &&
    (alert.resolvedAt === null || typeof alert.resolvedAt === "string")
  );
}

/**
 * Parses one socket frame, returning null for anything that is not a message
 * this app models.
 *
 * A frame is untrusted input. Validating the fields the reducer reads keeps a
 * malformed payload from putting `undefined` on the map, and a `null` return
 * lets the caller drop it without taking the monitor down mid-rally.
 *
 * @param {string} raw - The frame body.
 * @returns {MonitorMessage | null} The parsed message, or null.
 */
export function parseMonitorMessage(raw: string): MonitorMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const message = parsed as Record<string, unknown>;
  const isCode = typeof message.vehicleCode === "string" && message.vehicleCode !== "";

  switch (message.type) {
    case "vehicle_position":
      return isCode && typeof message.lat === "number" && typeof message.lng === "number"
        ? (message as unknown as MonitorMessage)
        : null;

    case "task_completed":
      return isCode && typeof message.taskCode === "string"
        ? (message as unknown as MonitorMessage)
        : null;

    case "score_delta":
      return isCode && typeof message.total === "number"
        ? (message as unknown as MonitorMessage)
        : null;

    case "alert":
      return isAlertPayload(message.alert) ? (message as unknown as MonitorMessage) : null;

    case "leaderboard":
      return { type: "leaderboard", entries: [] };

    default:
      return null;
  }
}
