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

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Position, PositionFailure } from "@sensors/position";
import type { Fix, PingResult } from "@/types/session.model";
import { useLocationReporter } from "./useLocationReporter";

const RESULT: PingResult = { unlockedTaskIds: [], currentWaypointId: null, arrived: false, events: [] };

/** Each ping waits for the test to answer it, the way a slow network does. */
let pings: { fix: Fix; resolve: (r: PingResult) => void; reject: (e: Error) => void }[];
const ping = vi.fn((fix: Fix) => new Promise<PingResult>((resolve, reject) => pings.push({ fix, resolve, reject })));
vi.mock("@services/session", () => ({ ping: (fix: Fix) => ping(fix) }));

const watches: { onPosition: (p: Position) => void; onError?: (r: PositionFailure) => void; stopped: boolean }[] = [];
vi.mock("@sensors/position", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sensors/position")>()),
  watchPosition: (onPosition: (p: Position) => void, onError?: (r: PositionFailure) => void) => {
    const watch = { onPosition, onError, stopped: false };
    watches.push(watch);
    return () => {
      watch.stopped = true;
    };
  },
}));

const fix = (position: Position) => act(() => watches[watches.length - 1].onPosition(position));
const fail = (reason: PositionFailure) => act(() => watches[watches.length - 1].onError?.(reason));
const answer = async (n: number, result: PingResult = RESULT) => {
  await act(async () => pings[n].resolve(result));
};

const A: Position = { lat: 6.89, lng: 79.92, accuracy: 8 };
const B: Position = { lat: 6.891, lng: 79.921, accuracy: 8 };
const C: Position = { lat: 6.892, lng: 79.922, accuracy: 8 };

beforeEach(() => {
  pings = [];
  ping.mockClear();
  watches.length = 0;
});

describe("useLocationReporter", () => {
  it("reports nothing until it is started", () => {
    renderHook(() => useLocationReporter());

    expect(watches).toHaveLength(0);
  });

  it("reports every fix once started", async () => {
    const { result } = renderHook(() => useLocationReporter());

    act(() => result.current.start());
    fix(A);

    expect(ping).toHaveBeenCalledWith(expect.objectContaining({ lat: 6.89, lng: 79.92, accuracy: 8 }));
    expect(result.current.sharing).toBe(true);
    expect(result.current.position).toEqual(A);
  });

  // A car already under way reports from whichever screen the phone opens on.
  it("starts by itself when told the car is under way", () => {
    renderHook(() => useLocationReporter({ autoStart: true }));

    expect(watches).toHaveLength(1);
  });

  // On a slow link the fixes outrun the requests. Only the newest live one is
  // worth sending; the ones in between say nothing the newest does not.
  it("sends one ping at a time, and only the newest live fix that waited", async () => {
    renderHook(() => useLocationReporter({ autoStart: true }));
    fix(A);
    fix(B);
    fix(C);
    expect(ping).toHaveBeenCalledTimes(1);

    await answer(0);

    expect(ping).toHaveBeenCalledTimes(2);
    expect(pings[1].fix).toMatchObject({ lat: C.lat, lng: C.lng });
  });

  // A buffered flush is the drive the phone recorded in the background. Every
  // fix in it may cross a geofence, so none is skipped, and each keeps its time.
  it("sends every buffered fix, in order, with when it was taken", async () => {
    renderHook(() => useLocationReporter({ autoStart: true }));
    const t1 = new Date("2027-02-14T04:00:00Z");
    const t2 = new Date("2027-02-14T04:00:05Z");
    fix(A);
    fix({ ...B, buffered: true, takenAt: t1 });
    fix({ ...C, buffered: true, takenAt: t2 });

    await answer(0);
    await answer(1);

    expect(pings.map((p) => p.fix.takenAt)).toEqual([undefined, t1, t2]);
  });

  it("hands each answer to onResult", async () => {
    const onResult = vi.fn();
    renderHook(() => useLocationReporter({ autoStart: true, onResult }));
    fix(A);
    const unlocked = { ...RESULT, unlockedTaskIds: ["t6"] };

    await answer(0, unlocked);

    expect(onResult).toHaveBeenCalledWith(unlocked);
  });

  it("says so when a ping does not land, until one does", async () => {
    const { result } = renderHook(() => useLocationReporter({ autoStart: true }));
    fix(A);
    await act(async () => pings[0].reject(new Error("Could not reach the rally server.")));
    expect(result.current.pingError).toBe("Could not reach the rally server.");

    fix(B);
    await answer(1);

    await waitFor(() => expect(result.current.pingError).toBeNull());
  });

  it("stops sharing on a location failure, and asks again on start", () => {
    const { result } = renderHook(() => useLocationReporter({ autoStart: true }));
    fix(A);
    fail("permission_denied");

    expect(result.current.sharing).toBe(false);
    expect(result.current.failure).toBe("permission_denied");
    expect(result.current.position).toBeNull();

    act(() => result.current.start());

    expect(watches).toHaveLength(2);
    expect(result.current.failure).toBeNull();
  });

  // A finished run refuses pings; a phone that kept sending them would burn
  // battery on errors for the rest of the day.
  it("stops for good once the run is over, even if started", () => {
    const { result, rerender } = renderHook(({ runOver }) => useLocationReporter({ autoStart: true, runOver }), {
      initialProps: { runOver: false },
    });
    act(() => result.current.start());

    rerender({ runOver: true });

    expect(watches[0].stopped).toBe(true);
    expect(watches).toHaveLength(1);
    expect(result.current.sharing).toBe(false);
  });

  // B4 calls start on mount. Were start to change on a failure, that effect
  // would re-run and retry a refused permission in a loop.
  it("keeps start stable across a failure", () => {
    const { result } = renderHook(() => useLocationReporter({ autoStart: true }));
    const first = result.current.start;

    fail("unavailable");

    expect(result.current.start).toBe(first);
  });

  it("stops watching when it unmounts", () => {
    const { unmount } = renderHook(() => useLocationReporter({ autoStart: true }));

    unmount();

    expect(watches[0].stopped).toBe(true);
  });
});
