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
import type { PingResult } from "@/types/session.model";
import { eventsOfPing, routeFor } from "./sessionEvents";

describe("routeFor", () => {
  it("takes a car that arrived to its arrival screen, from anywhere", () => {
    expect(routeFor({ type: "arrival" }, "/task/t6")).toBe("/arrival");
  });

  it("holds the car for a rest stop, from anywhere", () => {
    expect(routeFor({ type: "rest_lock", taskId: "t12" }, "/route")).toBe("/rest");
  });

  // A timed question is open now; it cannot wait for the crew to find it.
  it("opens a timed question at once", () => {
    expect(routeFor({ type: "trivia", taskId: "t14" }, "/route")).toBe("/task/t14");
  });

  it("opens a newly unlocked task from the route screen", () => {
    expect(routeFor({ type: "task_unlocked", taskIds: ["t6", "t7"] }, "/route")).toBe("/task/t6");
  });

  // A crew mid-way through one task is not pulled into the next.
  it("leaves a crew on another screen where it is", () => {
    expect(routeFor({ type: "task_unlocked", taskIds: ["t6"] }, "/task/t5")).toBeNull();
    expect(routeFor({ type: "task_unlocked", taskIds: ["t6"] }, "/report")).toBeNull();
  });

  // Every event arrives twice on the phone that pinged: in its ping's answer
  // and on the socket. The second must not stack another copy of the screen.
  it("goes nowhere when the crew is already there", () => {
    expect(routeFor({ type: "arrival" }, "/arrival")).toBeNull();
    expect(routeFor({ type: "trivia", taskId: "t14" }, "/task/t14")).toBeNull();
  });

  it("moves nobody for an empty unlock", () => {
    expect(routeFor({ type: "task_unlocked", taskIds: [] }, "/route")).toBeNull();
  });
});

describe("eventsOfPing", () => {
  const result = (overrides: Partial<PingResult>): PingResult => ({
    unlockedTaskIds: [],
    currentWaypointId: null,
    arrived: false,
    events: [],
    ...overrides,
  });

  it("reads a ping's answer as the frames the socket would carry", () => {
    expect(
      eventsOfPing(
        result({
          unlockedTaskIds: ["t6"],
          events: [
            { type: "geofence", waypointId: "w3", taskId: null },
            { type: "rest_lock", waypointId: null, taskId: "t12" },
            { type: "trivia", waypointId: null, taskId: "t14" },
            { type: "arrival", waypointId: null, taskId: null },
          ],
        }),
      ),
    ).toEqual([
      { type: "task_unlocked", taskIds: ["t6"] },
      { type: "rest_lock", taskId: "t12" },
      { type: "trivia", taskId: "t14" },
      { type: "arrival" },
    ]);
  });

  it("is empty for a ping that changed nothing", () => {
    expect(eventsOfPing(result({}))).toEqual([]);
  });
});
