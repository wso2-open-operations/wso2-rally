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

import { afterEach, describe, expect, it, vi } from "vitest";
import { computeEfficiencyIndex, requestMotionPermission, trackMotion, type MotionSample } from "./motion";

const setDeviceMotionEvent = (value: unknown): void => {
  Object.defineProperty(window, "DeviceMotionEvent", { value, configurable: true, writable: true });
};

afterEach(() => setDeviceMotionEvent(undefined));

describe("computeEfficiencyIndex", () => {
  it("counts hard stops and sharp turns from samples", () => {
    const samples: MotionSample[] = [
      { acc: 2, rot: 5 },
      { acc: 14, rot: 5 }, // 1 hard stop (acc > 12)
      { acc: 3, rot: 220 }, // 1 sharp turn (rot > 180)
    ];

    expect(computeEfficiencyIndex(samples)).toEqual({ hardStops: 1, sharpTurns: 1 });
  });

  // devicemotion fires ~60 times a second, so one firm stop spans dozens of
  // samples. Counting samples would score a single stop as thirty.
  it("counts one event per crossing, not one per sample", () => {
    const braking = Array.from({ length: 30 }, () => ({ acc: 13, rot: 0 }));
    const samples = [{ acc: 1, rot: 0 }, ...braking, { acc: 1, rot: 0 }, ...braking];

    expect(computeEfficiencyIndex(samples).hardStops).toBe(2);
  });

  it("takes the thresholds from the task when it sets them", () => {
    const samples = [{ acc: 8, rot: 120 }];

    expect(computeEfficiencyIndex(samples, { hardStopMps2: 7, sharpTurnDegPerS: 100 })).toEqual({
      hardStops: 1,
      sharpTurns: 1,
    });
  });

  it("is zero for no samples", () => {
    expect(computeEfficiencyIndex([])).toEqual({ hardStops: 0, sharpTurns: 0 });
  });
});

describe("requestMotionPermission", () => {
  // iOS gates motion behind a prompt that must come from a tap.
  it("asks iOS and reports the answer", async () => {
    setDeviceMotionEvent({ requestPermission: vi.fn().mockResolvedValue("denied") });

    await expect(requestMotionPermission()).resolves.toBe(false);
  });

  it("is granted outright where no prompt exists", async () => {
    setDeviceMotionEvent(function DeviceMotionEvent() {});

    await expect(requestMotionPermission()).resolves.toBe(true);
  });

  it("is false where there is no motion sensor API at all", async () => {
    await expect(requestMotionPermission()).resolves.toBe(false);
  });
});

describe("trackMotion", () => {
  const motion = (init: object): Event => Object.assign(new Event("devicemotion"), init);

  it("turns devicemotion into samples and stops when asked", () => {
    const samples: MotionSample[] = [];
    const stop = trackMotion((s) => samples.push(s));

    window.dispatchEvent(
      motion({ acceleration: { x: 3, y: 4, z: 0 }, rotationRate: { alpha: 0, beta: 0, gamma: 200 } }),
    );
    stop();
    window.dispatchEvent(motion({ acceleration: { x: 9, y: 9, z: 9 }, rotationRate: null }));

    expect(samples).toEqual([{ acc: 5, rot: 200 }]);
  });

  // Some Android WebViews report only acceleration including gravity.
  it("subtracts gravity when only the raw reading is available", () => {
    const samples: MotionSample[] = [];
    const stop = trackMotion((s) => samples.push(s));

    window.dispatchEvent(motion({ acceleration: null, accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 } }));
    stop();

    expect(samples[0].acc).toBeCloseTo(0, 1);
  });
});
