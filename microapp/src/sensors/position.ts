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

import { subscribeLocation, type LocationFix, type LocationRequestOptions } from "@utils/bridge";
import type { Fix } from "@/types/session.model";

/**
 * Where the car is.
 *
 * The fix source sits behind an interface because there are two, and which one
 * works depends on the host:
 *
 * - **The super app's `location` topic** (`bridgePositionSource`) — the
 *   supported path. Native owns the sensor, which is the only arrangement that
 *   works from a `file://` origin *and* keeps reporting while the driver is in
 *   Google Maps: fixes taken in the background are buffered and flushed on
 *   resume.
 * - **`navigator.geolocation`** (`webPositionSource`) — a fallback for a desktop
 *   browser and for a super app without the location topic. Inside the WebView
 *   it is usually refused, and it stops whenever the app is backgrounded.
 *
 * A source that cannot deliver says why through `onError`. A rally phone that
 * silently reports nothing looks exactly like a parked car on the organizer's
 * monitor, so a failure is never swallowed.
 */

/** A position, shaped so it can go straight to `session.ping`. */
export interface Position extends Fix {
  /** True on a fix the super app recorded while backgrounded and flushed on resume. */
  buffered?: boolean;
}

/** Why no position is coming. The first five are the super app's own reasons. */
export type PositionFailure =
  | "permission_denied"
  | "background_permission_denied"
  | "services_disabled"
  | "not_declared"
  | "unavailable"
  | "timeout";

export class PositionError extends Error {
  readonly reason: PositionFailure;

  constructor(reason: PositionFailure) {
    super(describePositionFailure(reason));
    this.name = "PositionError";
    this.reason = reason;
  }
}

export interface PositionSource {
  /** Starts delivering positions. Call the returned function to stop. */
  watch(onPosition: (position: Position) => void, onError?: (reason: PositionFailure) => void): () => void;
}

const FAILURES: Record<PositionFailure, string> = {
  permission_denied: "This phone has not allowed the rally app to use location. Allow it in the phone's settings.",
  background_permission_denied:
    "Location stops when the rally app is in the background. Allow location “Always”, or keep the app open.",
  services_disabled: "Location is switched off on this phone. Turn it on to keep reporting the car's position.",
  not_declared: "This version of the rally app is not allowed to use location. Update it from the super app's store.",
  unavailable: "This phone cannot provide a location right now. Another crew member's phone can report instead.",
  timeout: "No location fix yet. Move somewhere with a clearer view of the sky, or try another phone.",
};

/** A sentence the crew can act on, for each way location can fail. */
export function describePositionFailure(reason: PositionFailure): string {
  return FAILURES[reason] ?? FAILURES.unavailable;
}

const asFailure = (reason: string): PositionFailure =>
  reason in FAILURES ? (reason as PositionFailure) : "unavailable";

// ── the super app's location topic ───────────────────────────────────────────

/**
 * What the rally asks the host for: navigation-grade fixes every 10 m, kept up
 * in the background because the route screen hands the driver to Google Maps.
 */
const STREAM_OPTIONS: LocationRequestOptions = { accuracy: "high", distanceIntervalM: 10, background: true };

/**
 * A live fix carries no time: the backend refuses a `ts` more than 30 s ahead of
 * its clock, so on a phone whose clock runs fast, stamping live fixes would get
 * every ping refused. Only a buffered fix needs its original time — judged by
 * arrival, a replay reads as teleports (BE-20).
 */
const fromFix = (fix: LocationFix): Position => {
  const position: Position = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, buffered: fix.buffered === true };
  if (position.buffered) {
    const takenAt = new Date(fix.ts);
    if (!Number.isNaN(takenAt.getTime())) {
      position.takenAt = takenAt;
    }
  }

  return position;
};

interface Watcher {
  onPosition: (position: Position) => void;
  onError?: (reason: PositionFailure) => void;
}

const watchers = new Set<Watcher>();
let stopHostStream: (() => void) | null = null;

/**
 * The host keeps a single location stream per micro app, and starting a second
 * replaces the first. So every watcher shares one stream: it opens with the
 * first watcher and closes with the last.
 */
export const bridgePositionSource: PositionSource = {
  watch(onPosition, onError) {
    const watcher: Watcher = { onPosition, onError };
    watchers.add(watcher);

    if (!stopHostStream) {
      stopHostStream = subscribeLocation(
        STREAM_OPTIONS,
        (fix) => watchers.forEach((w) => w.onPosition(fromFix(fix))),
        (reason) => {
          // A refused stream is gone. Forget it, so the next watch asks again —
          // after the crew has, say, allowed location in settings.
          stopHostStream?.();
          stopHostStream = null;
          watchers.forEach((w) => w.onError?.(asFailure(reason)));
        },
      );
    }

    return () => {
      if (!watchers.delete(watcher)) return;
      if (watchers.size === 0 && stopHostStream) {
        stopHostStream();
        stopHostStream = null;
      }
    };
  },
};

// ── the browser's geolocation ─────────────────────────────────────────────────

const WEB_ERRORS: Record<number, PositionFailure> = { 1: "permission_denied", 2: "unavailable", 3: "timeout" };

export const webPositionSource: PositionSource = {
  watch(onPosition, onError) {
    const geolocation = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geolocation) {
      onError?.("unavailable");
      return () => {};
    }

    const id = geolocation.watchPosition(
      (position) =>
        onPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      (error) => onError?.(WEB_ERRORS[error.code] ?? "unavailable"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );

    return () => geolocation.clearWatch(id);
  },
};

// ── choosing ─────────────────────────────────────────────────────────────────

/**
 * The super app's topic when the host offers it, the web API otherwise. An
 * older super app still injects a bridge but has no location topic, so the
 * test is for the topic itself, not for the bridge.
 */
export function positionSource(): PositionSource {
  return typeof window.nativebridge?.requestLocationUpdates === "function" ? bridgePositionSource : webPositionSource;
}

export function watchPosition(
  onPosition: (position: Position) => void,
  onError?: (reason: PositionFailure) => void,
): () => void {
  return positionSource().watch(onPosition, onError);
}

/** One position, then stop. Rejects with a `PositionError` rather than waiting forever. */
export function getCurrent(timeoutMs = 30_000): Promise<Position> {
  return new Promise<Position>((resolve, reject) => {
    let settled = false;
    let stop: () => void = () => {};
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop();
      outcome();
    };
    const timer = setTimeout(() => settle(() => reject(new PositionError("timeout"))), timeoutMs);

    stop = watchPosition(
      (position) => settle(() => resolve(position)),
      (reason) => settle(() => reject(new PositionError(reason))),
    );
    // A source that answered synchronously settled before `stop` was assigned.
    if (settled) stop();
  });
}
