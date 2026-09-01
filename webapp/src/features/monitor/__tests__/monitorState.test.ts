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

import { describe, it, expect } from "vitest";
import {
  emptyMonitorState,
  fromSnapshot,
  monitorReducer,
  parseMonitorMessage,
} from "@features/monitor/monitorState";
import type { MonitorSnapshot } from "@/types/monitor";

const snapshot: MonitorSnapshot = {
  openAlerts: 1,
  vehicles: [
    {
      vehicleCode: "PKT-001",
      teamName: "Data Dashers",
      status: "ok",
      sessionStatus: "active",
      done: 10,
      totalTasks: 15,
      totalScore: 420,
      lastLat: 6.89,
      lastLng: 79.92,
      lastSeenAt: "2027-02-13T09:30:00Z",
    },
    {
      vehicleCode: "PKT-002",
      teamName: "Sync Squad",
      status: "breakdown",
      sessionStatus: "active",
      done: 7,
      totalTasks: 15,
      totalScore: 300,
      lastLat: null,
      lastLng: null,
      lastSeenAt: null,
    },
  ],
};

describe("monitorReducer", () => {
  it("seeds itself from the REST snapshot", () => {
    const state = fromSnapshot(snapshot);

    expect(Object.keys(state.vehicles)).toEqual(["PKT-001", "PKT-002"]);
    expect(state.vehicles["PKT-001"].done).toBe(10);
    expect(state.vehicles["PKT-001"].lat).toBe(6.89);
    expect(state.openAlerts).toBe(1);
  });

  it("moves a vehicle on vehicle_position", () => {
    const state = monitorReducer(fromSnapshot(snapshot), {
      type: "vehicle_position",
      vehicleCode: "PKT-001",
      lat: 6.95,
      lng: 79.85,
    });

    expect(state.vehicles["PKT-001"].lat).toBe(6.95);
    expect(state.vehicles["PKT-001"].lng).toBe(79.85);
    // Everything else about the vehicle survives a position update.
    expect(state.vehicles["PKT-001"].done).toBe(10);
    expect(state.vehicles["PKT-001"].teamName).toBe("Data Dashers");
  });

  it("increments the completion count on task_completed", () => {
    const state = monitorReducer(fromSnapshot(snapshot), {
      type: "task_completed",
      vehicleCode: "PKT-002",
      taskCode: "T8",
    });

    expect(state.vehicles["PKT-002"].done).toBe(8);
    // Only the reporting vehicle moves.
    expect(state.vehicles["PKT-001"].done).toBe(10);
  });

  // The count must not creep past the library size if a duplicate arrives.
  it("never counts more tasks than the route has", () => {
    let state = fromSnapshot(snapshot);
    for (let i = 0; i < 10; i += 1) {
      state = monitorReducer(state, {
        type: "task_completed",
        vehicleCode: "PKT-001",
        taskCode: "T1",
      });
    }

    expect(state.vehicles["PKT-001"].done).toBe(15);
  });

  it("takes the authoritative total from score_delta rather than adding up deltas", () => {
    const state = monitorReducer(fromSnapshot(snapshot), {
      type: "score_delta",
      vehicleCode: "PKT-001",
      delta: -40,
      total: 380,
    });

    expect(state.vehicles["PKT-001"].totalScore).toBe(380);
  });

  // A car that bound after the snapshot was taken still has to appear, or it
  // would be invisible on the map for the rest of the rally.
  it("adopts a vehicle it has never seen before", () => {
    const state = monitorReducer(fromSnapshot(snapshot), {
      type: "vehicle_position",
      vehicleCode: "PKT-099",
      lat: 7.1,
      lng: 79.9,
    });

    expect(state.vehicles["PKT-099"]).toMatchObject({
      vehicleCode: "PKT-099",
      lat: 7.1,
      done: 0,
    });
  });

  it("keeps the newest alerts first and counts the open ones", () => {
    let state = fromSnapshot(snapshot);
    state = monitorReducer(state, {
      type: "alert",
      alert: {
        id: "a1",
        vehicleId: "v1",
        type: "breakdown",
        note: "Flat tyre",
        source: "crew",
        raisedAt: "2027-02-13T10:00:00Z",
        resolvedAt: null,
      },
    });
    state = monitorReducer(state, {
      type: "alert",
      alert: {
        id: "a2",
        vehicleId: "v2",
        type: "device_issue",
        note: "GPS dropping",
        source: "crew",
        raisedAt: "2027-02-13T10:05:00Z",
        resolvedAt: null,
      },
    });

    expect(state.alerts.map((alert) => alert.id)).toEqual(["a2", "a1"]);
  });

  // Resolving is broadcast on the same message as raising, so the strip has to
  // replace the alert rather than list it twice.
  it("replaces an alert when the same one is resolved", () => {
    let state = monitorReducer(fromSnapshot(snapshot), {
      type: "alert",
      alert: {
        id: "a1",
        vehicleId: "v1",
        type: "breakdown",
        note: "Flat tyre",
        source: "crew",
        raisedAt: "2027-02-13T10:00:00Z",
        resolvedAt: null,
      },
    });
    state = monitorReducer(state, {
      type: "alert",
      alert: {
        id: "a1",
        vehicleId: "v1",
        type: "breakdown",
        note: "Flat tyre",
        source: "crew",
        raisedAt: "2027-02-13T10:00:00Z",
        resolvedAt: "2027-02-13T10:20:00Z",
      },
    });

    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0].resolvedAt).toBe("2027-02-13T10:20:00Z");
  });

  it("leaves the state alone for a message it does not model", () => {
    const before = fromSnapshot(snapshot);

    const after = monitorReducer(before, {
      type: "leaderboard",
      entries: [],
    });

    expect(after).toBe(before);
  });
});

describe("parseMonitorMessage", () => {
  it("accepts the message shapes in the asyncapi contract", () => {
    expect(
      parseMonitorMessage('{"type":"vehicle_position","vehicleCode":"PKT-001","lat":1,"lng":2}'),
    ).toEqual({ type: "vehicle_position", vehicleCode: "PKT-001", lat: 1, lng: 2 });
  });

  // A socket frame is untrusted input: anything unparseable has to be dropped
  // rather than crash the monitor an organizer is watching mid-rally.
  it("returns null for junk instead of throwing", () => {
    expect(parseMonitorMessage("not json")).toBeNull();
    expect(parseMonitorMessage("[]")).toBeNull();
    expect(parseMonitorMessage('{"no":"type"}')).toBeNull();
    expect(parseMonitorMessage('{"type":"vehicle_position","vehicleCode":"x"}')).toBeNull();
  });

  it("starts from an empty state before any snapshot arrives", () => {
    expect(emptyMonitorState().vehicles).toEqual({});
    expect(emptyMonitorState().alerts).toEqual([]);
  });
});
