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
import {
  bridgePositionSource,
  describePositionFailure,
  getCurrent,
  PositionError,
  positionSource,
  webPositionSource,
  type Position,
} from "./position";

type Bridge = Record<string, (...args: never[]) => unknown>;

const setGeolocation = (geolocation: unknown): void => {
  Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true });
};

/** A super app whose location topic the test drives by hand. */
const embedLocation = () => {
  const bridge: Bridge = {
    requestLocationUpdates: vi.fn(),
    requestStopLocationUpdates: vi.fn(),
  };
  (window as unknown as { nativebridge: Bridge }).nativebridge = bridge;
  const fix = (f: object) => (bridge.resolveLocationUpdate as unknown as (x: object) => void)(f);
  const reject = (reason: string) => (bridge.rejectLocationUpdates as unknown as (x: string) => void)(reason);

  return { bridge, fix, reject };
};

afterEach(() => {
  delete (window as unknown as { nativebridge?: unknown }).nativebridge;
  setGeolocation(undefined);
});

describe("webPositionSource", () => {
  it("delivers normalized positions from the web API", () => {
    const clear = vi.fn();
    setGeolocation({
      watchPosition: (ok: (p: unknown) => void) => {
        ok({ coords: { latitude: 6.9, longitude: 79.9, accuracy: 8 } });
        return 7;
      },
      clearWatch: clear,
    });
    const positions: Position[] = [];

    const stop = webPositionSource.watch((p) => positions.push(p));

    expect(positions[0]).toEqual({ lat: 6.9, lng: 79.9, accuracy: 8 });
    stop();
    expect(clear).toHaveBeenCalledWith(7);
  });

  // A phone clock a minute fast would turn every timestamped live ping into a
  // 400 from the backend. A live fix carries no time; the server uses its own.
  it("does not stamp a live fix with the phone's clock", () => {
    setGeolocation({
      watchPosition: (ok: (p: unknown) => void) => {
        ok({ coords: { latitude: 6.9, longitude: 79.9, accuracy: 8 }, timestamp: Date.now() + 60_000 });
        return 1;
      },
      clearWatch: vi.fn(),
    });
    const positions: Position[] = [];

    webPositionSource.watch((p) => positions.push(p));

    expect(positions[0].takenAt).toBeUndefined();
  });

  it("names the failure instead of going quiet", () => {
    setGeolocation({
      watchPosition: (_ok: unknown, fail: (e: unknown) => void) => {
        fail({ code: 1, message: "User denied Geolocation" });
        return 1;
      },
      clearWatch: vi.fn(),
    });
    const onError = vi.fn();

    webPositionSource.watch(vi.fn(), onError);

    expect(onError).toHaveBeenCalledWith("permission_denied");
  });

  it("reports a WebView with no geolocation at all", () => {
    const onError = vi.fn();

    const stop = webPositionSource.watch(vi.fn(), onError);

    expect(onError).toHaveBeenCalledWith("unavailable");
    expect(stop).not.toThrow();
  });
});

describe("bridgePositionSource", () => {
  it("opens the super app's stream for high-accuracy, background-safe fixes", () => {
    const { bridge } = embedLocation();

    const stop = bridgePositionSource.watch(vi.fn());

    expect(bridge.requestLocationUpdates).toHaveBeenCalledWith({
      accuracy: "high",
      distanceIntervalM: 10,
      background: true,
    });
    stop();
  });

  // BE-20: a replayed fix keeps the moment it was taken. A live one does not,
  // for the clock-skew reason above.
  it("keeps the original time on buffered fixes only", () => {
    const { fix } = embedLocation();
    const positions: Position[] = [];
    const stop = bridgePositionSource.watch((p) => positions.push(p));

    fix({ lat: 6.9, lng: 79.9, accuracy: 6, ts: "2027-02-13T04:00:00.000Z" });
    fix({ lat: 6.8, lng: 79.8, accuracy: 9, ts: "2027-02-13T03:40:00.250Z", buffered: true });
    stop();

    expect(positions[0]).toEqual({ lat: 6.9, lng: 79.9, accuracy: 6, buffered: false });
    expect(positions[1]).toEqual({
      lat: 6.8,
      lng: 79.8,
      accuracy: 9,
      buffered: true,
      takenAt: new Date("2027-02-13T03:40:00.250Z"),
    });
  });

  // The host keeps one stream per micro app and starting again replaces it,
  // so two screens watching at once must share it, and it stays open until
  // the last one stops.
  it("shares one host stream between watchers", () => {
    const { bridge, fix } = embedLocation();
    const a: Position[] = [];
    const b: Position[] = [];

    const stopA = bridgePositionSource.watch((p) => a.push(p));
    const stopB = bridgePositionSource.watch((p) => b.push(p));
    fix({ lat: 1, lng: 1, accuracy: 5, ts: "2027-02-13T04:00:00Z" });

    expect(bridge.requestLocationUpdates).toHaveBeenCalledOnce();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);

    stopA();
    expect(bridge.requestStopLocationUpdates).not.toHaveBeenCalled();
    stopB();
    expect(bridge.requestStopLocationUpdates).toHaveBeenCalledOnce();
  });

  it("passes the host's refusal to every watcher, and retries on the next watch", () => {
    const { bridge, reject } = embedLocation();
    const onError = vi.fn();

    const stop = bridgePositionSource.watch(vi.fn(), onError);
    reject("not_declared");
    stop();
    bridgePositionSource.watch(vi.fn())();

    expect(onError).toHaveBeenCalledWith("not_declared");
    expect(bridge.requestLocationUpdates).toHaveBeenCalledTimes(2);
  });

  // A host may refuse inside requestLocationUpdates, before it returns. The
  // stream is gone all the same: a watcher arriving later must ask again, not
  // wait on a stream that will never deliver.
  it("treats a refusal made before the host returns as a closed stream", () => {
    const { bridge, reject } = embedLocation();
    bridge.requestLocationUpdates = vi.fn(() => reject("permission_denied"));
    const first = vi.fn();
    const second = vi.fn();

    const stopFirst = bridgePositionSource.watch(vi.fn(), first);
    const stopSecond = bridgePositionSource.watch(vi.fn(), second);

    expect(first).toHaveBeenCalledWith("permission_denied");
    expect(bridge.requestLocationUpdates).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledWith("permission_denied");
    stopFirst();
    stopSecond();
  });

  // A host that throws on the request has refused it, the same as one that
  // rejects: the watcher hears why, and the next watch asks again.
  it("treats a request the host throws on as a refusal", () => {
    const { bridge } = embedLocation();
    bridge.requestLocationUpdates = vi.fn(() => {
      throw new Error("bridge is gone");
    });
    const onError = vi.fn();

    let stop = () => {};
    expect(() => (stop = bridgePositionSource.watch(vi.fn(), onError))).not.toThrow();
    stop();
    bridgePositionSource.watch(vi.fn())();

    expect(onError).toHaveBeenCalledWith("unavailable");
    expect(bridge.requestLocationUpdates).toHaveBeenCalledTimes(2);
  });

  // The host sends a fix only after 10 m of movement, so a screen that starts
  // watching while the car is parked would hear nothing at all.
  it("hands the newest fix to a watcher that joins an open stream", () => {
    const { bridge, fix } = embedLocation();
    const stopFirst = bridgePositionSource.watch(vi.fn());
    fix({ lat: 6.8, lng: 79.8, accuracy: 9, ts: "2027-02-13T03:59:00Z" });
    fix({ lat: 6.9, lng: 79.9, accuracy: 6, ts: "2027-02-13T04:00:00Z" });
    const late: Position[] = [];

    const stopLate = bridgePositionSource.watch((p) => late.push(p));

    expect(late).toEqual([{ lat: 6.9, lng: 79.9, accuracy: 6, buffered: false }]);
    expect(bridge.requestLocationUpdates).toHaveBeenCalledOnce();
    stopFirst();
    stopLate();
  });

  // Once the stream closes the car may have gone anywhere: a fix from before
  // is not where it is now.
  it("forgets the last fix when the stream closes", () => {
    const { fix } = embedLocation();
    const stop = bridgePositionSource.watch(vi.fn());
    fix({ lat: 6.9, lng: 79.9, accuracy: 6, ts: "2027-02-13T04:00:00Z" });
    stop();
    const later: Position[] = [];

    bridgePositionSource.watch((p) => later.push(p))();

    expect(later).toEqual([]);
  });

  it("forgets the last fix when the host refuses the stream", () => {
    const { fix, reject } = embedLocation();
    const stop = bridgePositionSource.watch(vi.fn(), vi.fn());
    fix({ lat: 6.9, lng: 79.9, accuracy: 6, ts: "2027-02-13T04:00:00Z" });
    reject("services_disabled");
    stop();
    const later: Position[] = [];

    bridgePositionSource.watch((p) => later.push(p))();

    expect(later).toEqual([]);
  });
});

describe("positionSource", () => {
  // The whole point of the interface: the bridge wins when the host offers it,
  // so the native topic arriving is a swap, not a rewrite.
  it("prefers the bridge source when the host implements the location topic", () => {
    embedLocation();

    expect(positionSource()).toBe(bridgePositionSource);
  });

  // An older super app without the location topic still injects a bridge.
  it("falls back to the web API when the host has no location topic", () => {
    (window as unknown as { nativebridge: Bridge }).nativebridge = {};

    expect(positionSource()).toBe(webPositionSource);
  });
});

describe("getCurrent", () => {
  it("resolves with the first fix and stops watching", async () => {
    const { bridge, fix } = embedLocation();

    const current = getCurrent(1_000);
    fix({ lat: 6.9, lng: 79.9, accuracy: 6, ts: "2027-02-13T04:00:00Z" });

    await expect(current).resolves.toMatchObject({ lat: 6.9, lng: 79.9 });
    expect(bridge.requestStopLocationUpdates).toHaveBeenCalledOnce();
  });

  // The breakdown alert asks for a position while the map screen already holds
  // the stream open. A parked car sends no new fix, so without the last one
  // this ran out the clock and told the crew to look for a clearer sky.
  it("answers from a stream another screen holds open, without the car moving", async () => {
    const { fix } = embedLocation();
    const stop = bridgePositionSource.watch(vi.fn());
    fix({ lat: 6.9, lng: 79.9, accuracy: 6, ts: "2027-02-13T04:00:00Z" });

    await expect(getCurrent(50)).resolves.toMatchObject({ lat: 6.9, lng: 79.9 });
    stop();
  });

  it("rejects with the reason when location is refused", async () => {
    const { reject } = embedLocation();

    const current = getCurrent(1_000);
    reject("services_disabled");

    await expect(current).rejects.toMatchObject({ reason: "services_disabled" });
    await expect(current).rejects.toBeInstanceOf(PositionError);
  });

  it("rejects rather than waiting forever for a first fix", async () => {
    embedLocation();

    await expect(getCurrent(30)).rejects.toMatchObject({ reason: "timeout" });
  });
});

describe("describePositionFailure", () => {
  // A phone that silently reports nothing looks exactly like a parked car on
  // the organizer's monitor, so every reason gets words the crew can act on.
  it("has an actionable sentence for every reason", () => {
    for (const reason of [
      "permission_denied",
      "background_permission_denied",
      "services_disabled",
      "not_declared",
      "unavailable",
      "timeout",
    ] as const) {
      expect(describePositionFailure(reason).length, reason).toBeGreaterThan(20);
    }
  });
});
