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
 * The phone's motion sensors, for the telematics tasks (B6).
 *
 * `devicemotion` still works inside the super app's WebView. On iOS it is
 * gated behind a prompt that only a tap can trigger, so `requestMotionPermission`
 * must be called from a button's click handler, never on mount.
 */

/** One reading: linear acceleration in m/s² (gravity removed) and rotation rate in °/s. */
export interface MotionSample {
  acc: number;
  rot: number;
}

export interface EfficiencyIndex {
  hardStops: number;
  sharpTurns: number;
}

export interface MotionThresholds {
  /** Linear acceleration above which a reading is a hard stop (or launch). */
  hardStopMps2: number;
  /** Rotation rate above which a reading is a sharp turn. */
  sharpTurnDegPerS: number;
}

/**
 * Defaults from the plan. High on purpose: a phone in a car reads every pothole
 * as a jolt, and these are meant to catch driving a crew would agree was harsh.
 * A task can tighten them through its config.
 */
export const DEFAULT_THRESHOLDS: MotionThresholds = { hardStopMps2: 12, sharpTurnDegPerS: 180 };

const GRAVITY_MPS2 = 9.81;

/**
 * Counts hard stops and sharp turns.
 *
 * Counts *crossings*, not samples. `devicemotion` fires about sixty times a
 * second, so one firm stop spans dozens of readings over the threshold; it is
 * one stop, and is counted when the reading first rises above the line.
 *
 * Pure, so the scoring-relevant logic is testable without a sensor.
 */
export function computeEfficiencyIndex(
  samples: readonly MotionSample[],
  thresholds: MotionThresholds = DEFAULT_THRESHOLDS,
): EfficiencyIndex {
  let hardStops = 0;
  let sharpTurns = 0;
  let braking = false;
  let turning = false;

  for (const sample of samples) {
    const overAcc = sample.acc > thresholds.hardStopMps2;
    const overRot = sample.rot > thresholds.sharpTurnDegPerS;
    if (overAcc && !braking) hardStops += 1;
    if (overRot && !turning) sharpTurns += 1;
    braking = overAcc;
    turning = overRot;
  }

  return { hardStops, sharpTurns };
}

interface MotionPermissionApi {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
}

/**
 * Whether motion readings are available. Asks on iOS, where a prompt exists;
 * elsewhere the answer is simply whether the API is there.
 *
 * Call it from a tap handler: iOS refuses a prompt that was not triggered by
 * the user, and that refusal is thrown rather than answered.
 */
export async function requestMotionPermission(): Promise<boolean> {
  const api = (window as unknown as { DeviceMotionEvent?: MotionPermissionApi }).DeviceMotionEvent;
  if (!api) {
    return false;
  }
  if (typeof api.requestPermission === "function") {
    return (await api.requestPermission()) === "granted";
  }

  return true;
}

interface Vector {
  x: number | null;
  y: number | null;
  z: number | null;
}

interface Rotation {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
}

interface MotionEventLike {
  acceleration?: Vector | null;
  accelerationIncludingGravity?: Vector | null;
  rotationRate?: Rotation | null;
}

const magnitude = (...parts: Array<number | null>): number =>
  Math.sqrt(parts.reduce<number>((sum, part) => sum + (part ?? 0) ** 2, 0));

const hasReading = (v: Vector | null | undefined): v is Vector => !!v && (v.x !== null || v.y !== null || v.z !== null);

function toSample(event: MotionEventLike): MotionSample | null {
  let acc: number;
  if (hasReading(event.acceleration)) {
    acc = magnitude(event.acceleration.x, event.acceleration.y, event.acceleration.z);
  } else if (hasReading(event.accelerationIncludingGravity)) {
    // Some Android WebViews give only the raw reading. Removing gravity's
    // magnitude is approximate — it ignores the phone's tilt — but it keeps
    // the 9.8 m/s² baseline from reading as permanent hard braking.
    const g = event.accelerationIncludingGravity;
    acc = Math.abs(magnitude(g.x, g.y, g.z) - GRAVITY_MPS2);
  } else {
    return null;
  }

  const r = event.rotationRate;
  const rot = r ? magnitude(r.alpha, r.beta, r.gamma) : 0;

  return { acc, rot };
}

/** Streams motion samples until the returned function is called. */
export function trackMotion(onSample: (sample: MotionSample) => void): () => void {
  const handler = (event: Event): void => {
    const sample = toSample(event as unknown as MotionEventLike);
    if (sample) onSample(sample);
  };
  window.addEventListener("devicemotion", handler);

  return () => window.removeEventListener("devicemotion", handler);
}
