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

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Position, PositionFailure } from "@sensors/position";
import { useGeofence } from "./useGeofence";

/** The position stream, driven by hand: each watch is recorded with its callbacks. */
const watches: { onPosition: (p: Position) => void; onError?: (r: PositionFailure) => void; stop: () => void }[] = [];

vi.mock("@sensors/position", () => ({
  watchPosition: (onPosition: (p: Position) => void, onError?: (r: PositionFailure) => void) => {
    const stop = vi.fn();
    watches.push({ onPosition, onError, stop });
    return stop;
  },
}));

const latest = () => watches[watches.length - 1];

// The start grid, and two fixes: ~15 m from its centre and ~4.7 km away.
const GRID = { lat: 6.8901, lng: 79.92 };
const NEAR: Position = { lat: 6.8902, lng: 79.9201, accuracy: 8 };
const FAR: Position = { lat: 6.848, lng: 79.928, accuracy: 8 };

beforeEach(() => {
  watches.length = 0;
});

describe("useGeofence", () => {
  it("is outside, with the distance, while the fix is far from the centre", () => {
    const { result } = renderHook(() => useGeofence(GRID, 40));

    act(() => latest().onPosition(FAR));

    expect(result.current.inside).toBe(false);
    expect(result.current.distanceM).toBeGreaterThan(4_000);
    expect(result.current.position).toEqual(FAR);
  });

  it("is inside once a fix lands within the radius", () => {
    const { result } = renderHook(() => useGeofence(GRID, 40));

    act(() => latest().onPosition(FAR));
    act(() => latest().onPosition(NEAR));

    expect(result.current.inside).toBe(true);
    expect(result.current.distanceM).toBeLessThan(40);
  });

  it("knows nothing before the first fix", () => {
    const { result } = renderHook(() => useGeofence(GRID, 40));

    expect(result.current).toMatchObject({ inside: false, distanceM: null, position: null, failure: null });
  });

  // A guard that cannot judge must deny: with no centre there is nothing to be
  // inside of, wherever the phone is.
  it("is never inside without a centre, but still reports the fix", () => {
    const { result } = renderHook(() => useGeofence(null, 40));

    act(() => latest().onPosition(NEAR));

    expect(result.current.inside).toBe(false);
    expect(result.current.distanceM).toBeNull();
    expect(result.current.position).toEqual(NEAR);
  });

  // An earlier fix is no evidence once the source has failed; the lock must
  // not open on it.
  it("reports a failure and forgets the last fix", () => {
    const { result } = renderHook(() => useGeofence(GRID, 40));

    act(() => latest().onPosition(NEAR));
    act(() => latest().onError?.("permission_denied"));

    expect(result.current.failure).toBe("permission_denied");
    expect(result.current.inside).toBe(false);
    expect(result.current.position).toBeNull();
  });

  // After the crew allows location in settings, asking again is what restarts
  // a stream the host has already refused.
  it("watches again on retry, and clears the failure", () => {
    const { result } = renderHook(() => useGeofence(GRID, 40));
    act(() => latest().onError?.("permission_denied"));
    const first = latest();

    act(() => result.current.retry());

    expect(first.stop).toHaveBeenCalled();
    expect(watches).toHaveLength(2);
    expect(result.current.failure).toBeNull();
    act(() => latest().onPosition(NEAR));
    expect(result.current.inside).toBe(true);
  });

  // The host's stream drains a battery until the last watcher lets go.
  it("stops watching when the screen goes away", () => {
    const { unmount } = renderHook(() => useGeofence(GRID, 40));

    unmount();

    expect(latest().stop).toHaveBeenCalled();
  });
});
