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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@store/session";
import type { SessionModel } from "@/types/session.model";
import {
  initialSessionSocket,
  parseSessionFrame,
  sessionSocketReducer,
  useSessionSocket,
  type SessionSocketState,
} from "./useSessionSocket";

vi.mock("@config/endpoints", () => ({ WS_URL: "ws://backend.test/ws" }));

// ── the pure reducer ─────────────────────────────────────────────────────────

const frame = (data: object) => sessionSocketReducer(initialSessionSocket, { type: "frame", frame: data as never });

describe("sessionSocketReducer", () => {
  it("reveals the cipher", () => {
    expect(frame({ type: "cipher_reveal", cipher: "47°N // PKT → EDGE" }).cipher).toBe("47°N // PKT → EDGE");
  });

  it("releases the start, remembering which start it was for", () => {
    const next = frame({ type: "start_signal", startsAt: "2027-02-14T03:30:00Z" });

    expect(next.startSignal).toBe(true);
    expect(next.startsAt?.toISOString()).toBe("2027-02-14T03:30:00.000Z");
  });

  it("records arrival", () => {
    expect(frame({ type: "arrival" }).arrived).toBe(true);
  });

  // A rest stop ends when its task is submitted, which no frame announces. Kept
  // here it would read as locked for the rest of the day; onFrame acts on it.
  it("keeps no state for the frames that are events", () => {
    for (const data of [
      { type: "rest_lock", taskId: "t12" },
      { type: "trivia", taskId: "t14" },
      { type: "task_unlocked", taskIds: ["t6"], currentWaypointId: "w3" },
      { type: "task_completed", taskId: "t6", taskCode: "T6", totalScore: 640 },
    ]) {
      expect(frame(data), data.type).toBe(initialSessionSocket);
    }
  });

  it("follows coverage as the frames report it", () => {
    const lost = frame({ type: "coverage_lost", lastReportAt: null });
    expect(lost.coverageLost).toBe(true);

    const restored = sessionSocketReducer(lost, { type: "frame", frame: { type: "coverage_restored" } });
    expect(restored.coverageLost).toBe(false);
  });

  // The hub keeps no history: what was broadcast while the socket was down is
  // gone, so a reconnect forgets the last coverage frame and the screen goes
  // back to GET /sessions/me, which the reconnect refetches.
  it("forgets coverage across a reconnect, but not the start", () => {
    let state: SessionSocketState = frame({ type: "coverage_lost", lastReportAt: null });
    state = sessionSocketReducer(state, {
      type: "frame",
      frame: { type: "start_signal", startsAt: "2027-02-14T03:30:00Z" },
    });
    state = sessionSocketReducer(state, { type: "closed" });
    expect(state.connected).toBe(false);

    state = sessionSocketReducer(state, { type: "opened" });

    expect(state.connected).toBe(true);
    expect(state.coverageLost).toBeNull();
    expect(state.startSignal).toBe(true);
  });

  // Delivery is at least once, so the same start can arrive twice.
  it("treats a repeated start as the same start", () => {
    const once = frame({ type: "start_signal", startsAt: "2027-02-14T03:30:00Z" });
    const twice = sessionSocketReducer(once, {
      type: "frame",
      frame: { type: "start_signal", startsAt: "2027-02-14T03:30:00Z" },
    });

    expect(twice).toEqual(once);
  });
});

describe("parseSessionFrame", () => {
  it("reads a frame", () => {
    expect(parseSessionFrame('{"type":"cipher_reveal","cipher":"API"}')).toEqual({
      type: "cipher_reveal",
      cipher: "API",
    });
  });

  it("drops what is not a frame", () => {
    for (const raw of ["not json", "[]", "null", '{"cipher":"no type"}', '{"type":7}']) {
      expect(parseSessionFrame(raw), raw).toBeNull();
    }
  });
});

// ── the socket ───────────────────────────────────────────────────────────────

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  closedWith: number | null = null;
  readonly url: string;
  readonly protocols: string[];

  constructor(url: string, protocols: string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeSocket.all.push(this);
  }

  close(code = 1000): void {
    this.closedWith = code;
  }

  // Driven by the test.
  open(): void {
    act(() => this.onopen?.());
  }
  send(data: object | string): void {
    act(() => this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) }));
  }
  drop(): void {
    act(() => this.onclose?.({ code: 1006, reason: "" }));
  }
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1];

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers();
  useSessionStore.getState().setJoined("team-tok", { id: "s1" } as SessionModel);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useSessionStore.getState().clear();
});

describe("useSessionSocket", () => {
  // The token rides in the subprotocol list: a browser can set no header on a
  // handshake, and a token in the query string lands in the backend's log.
  it("subscribes to its own session with the team token as a subprotocol", () => {
    renderHook(() => useSessionSocket("s1"));

    expect(FakeSocket.all).toHaveLength(1);
    expect(latest().url).toBe("ws://backend.test/ws?topic=session:s1");
    expect(latest().protocols).toEqual(["rally-bearer", "team-tok"]);
  });

  it("reduces the frames it receives", () => {
    const { result } = renderHook(() => useSessionSocket("s1"));
    latest().open();

    latest().send({ type: "start_signal", startsAt: "2027-02-14T03:30:00Z" });
    latest().send({ type: "cipher_reveal", cipher: "API Integration" });

    expect(result.current.connected).toBe(true);
    expect(result.current.startSignal).toBe(true);
    expect(result.current.cipher).toBe("API Integration");
  });

  it("hands every frame to onFrame, and ignores garbage", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onFrame = vi.fn();
    renderHook(() => useSessionSocket("s1", { onFrame }));
    latest().open();

    latest().send("not json");
    latest().send({ type: "task_unlocked", taskIds: ["t6"], currentWaypointId: "w3" });

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith({ type: "task_unlocked", taskIds: ["t6"], currentWaypointId: "w3" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reconnects after a drop, and asks for a refetch only on the reconnect", () => {
    const onReconnect = vi.fn();
    const { result } = renderHook(() => useSessionSocket("s1", { onReconnect }));
    latest().open();
    expect(onReconnect).not.toHaveBeenCalled();

    latest().drop();
    expect(result.current.connected).toBe(false);
    act(() => vi.advanceTimersByTime(1_000));

    expect(FakeSocket.all).toHaveLength(2);
    latest().open();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(result.current.connected).toBe(true);
  });

  // A reconnect an hour in must carry the token the phone holds now.
  it("reads the token afresh on every attempt", () => {
    renderHook(() => useSessionSocket("s1"));
    latest().drop();
    useSessionStore.getState().setToken("rotated");
    act(() => vi.advanceTimersByTime(1_000));

    expect(latest().protocols).toEqual(["rally-bearer", "rotated"]);
  });

  it("waits for a session id", () => {
    renderHook(() => useSessionSocket(null));

    expect(FakeSocket.all).toHaveLength(0);
  });

  // A 401 anywhere clears the store; a socket must not outlive the token.
  it("closes when the team token is forgotten, and does not reconnect", () => {
    renderHook(() => useSessionSocket("s1"));
    const socket = latest();
    socket.open();

    act(() => useSessionStore.getState().clear());
    act(() => vi.advanceTimersByTime(60_000));

    expect(socket.closedWith).toBe(1000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("closes cleanly on unmount", () => {
    const { unmount } = renderHook(() => useSessionSocket("s1"));
    const socket = latest();

    unmount();
    act(() => vi.advanceTimersByTime(60_000));

    expect(socket.closedWith).toBe(1000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
