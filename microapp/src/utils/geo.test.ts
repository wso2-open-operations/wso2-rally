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

import { describe, expect, it } from "vitest";
import { formatDistance, haversineMeters, pointInRadius } from "./geo";

// The same cases as the backend's internal/geo tests: the phone's answer has
// to agree with the server's, or a screen unlocks where the server would not.
describe("haversineMeters", () => {
  it("measures a known distance", () => {
    // Two points north/south of each other in the Colombo area, ~4.7 km apart.
    const d = haversineMeters({ lat: 6.8901, lng: 79.92 }, { lat: 6.848, lng: 79.928 });

    expect(Math.abs(d - 4700)).toBeLessThan(400);
  });

  it("is symmetric", () => {
    const a = { lat: 6.8901, lng: 79.92 };
    const b = { lat: 6.848, lng: 79.928 };

    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it("is zero between a point and itself", () => {
    expect(haversineMeters({ lat: 6.8901, lng: 79.92 }, { lat: 6.8901, lng: 79.92 })).toBe(0);
  });

  it("is half the circumference between antipodes", () => {
    expect(Math.abs(haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }) - 20_015_000)).toBeLessThan(5_000);
  });
});

describe("pointInRadius", () => {
  it.each([
    ["inside a 50 m boundary", { lat: 6.8901, lng: 79.92 }, { lat: 6.8902, lng: 79.9201 }, 50, true],
    ["kilometres away", { lat: 6.8901, lng: 79.92 }, { lat: 6.848, lng: 79.928 }, 50, false],
    ["exactly at the centre", { lat: 6.8901, lng: 79.92 }, { lat: 6.8901, lng: 79.92 }, 0, true],
    ["negative radius never matches", { lat: 6.8901, lng: 79.92 }, { lat: 6.8901, lng: 79.92 }, -1, false],
  ])("%s", (_name, point, center, radiusM, want) => {
    expect(pointInRadius(point, center, radiusM)).toBe(want);
  });
});

describe("formatDistance", () => {
  it("rounds to the metre under a kilometre", () => {
    expect(formatDistance(62.4)).toBe("62 m");
    expect(formatDistance(0)).toBe("0 m");
  });

  it("switches to kilometres with one decimal", () => {
    expect(formatDistance(1_000)).toBe("1.0 km");
    expect(formatDistance(4_730)).toBe("4.7 km");
  });
});
