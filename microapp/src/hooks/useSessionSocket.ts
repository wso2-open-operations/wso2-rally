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

import { useEffect, useReducer, useRef } from "react";
import { WS_URL } from "@config/endpoints";
import { useSessionStore } from "@store/session";
import type { SessionFrame } from "@/types/socket.dto";

/**
 * The subprotocol marking the token that follows it, mirroring the backend's
 * `authz.BearerSubprotocol`. A browser can set no header on a WebSocket
 * handshake, and a token in the query string would land in the backend's
 * request log, so `new WebSocket(url, [marker, token])` is the only channel.
 */
export const BEARER_SUBPROTOCOL = "rally-bearer";

/** Reconnect backoff, in milliseconds. The last value repeats. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/** What the session topic has said so far, reduced to what screens switch on. */
export interface SessionSocketState {
  /** True while a socket is open. */
  connected: boolean;
  /** The 09:00 release has arrived. */
  startSignal: boolean;
  /** The start the release was for. */
  startsAt: Date | null;
  cipher: string | null;
  /** The car reached the finish. Final: nothing un-arrives a run. */
  arrived: boolean;
  /**
   * The last coverage frame since the socket (re)opened; null when there has
   * been none, and the screen should go by `GET /sessions/me` instead.
   */
  coverageLost: boolean | null;
}

export const initialSessionSocket: SessionSocketState = {
  connected: false,
  startSignal: false,
  startsAt: null,
  cipher: null,
  arrived: false,
  coverageLost: null,
};

export type SessionSocketAction = { type: "opened" } | { type: "closed" } | { type: "frame"; frame: SessionFrame };

/**
 * Pure, so the rules live where a test can reach them without a socket.
 *
 * A frame that changes nothing returns the same state: the start arrives at
 * least once, and a repeat must not re-render every screen listening.
 */
export function sessionSocketReducer(state: SessionSocketState, action: SessionSocketAction): SessionSocketState {
  switch (action.type) {
    case "opened":
      // The hub keeps no history, so a coverage frame from before the drop may
      // already be stale. The caller refetches the session state on reconnect.
      return { ...state, connected: true, coverageLost: null };
    case "closed":
      return state.connected ? { ...state, connected: false } : state;
    case "frame":
      return reduceFrame(state, action.frame);
  }
}

function reduceFrame(state: SessionSocketState, frame: SessionFrame): SessionSocketState {
  switch (frame.type) {
    case "start_signal": {
      const startsAt = new Date(frame.startsAt);
      if (state.startSignal && state.startsAt?.getTime() === startsAt.getTime()) {
        return state;
      }
      return { ...state, startSignal: true, startsAt: Number.isNaN(startsAt.getTime()) ? null : startsAt };
    }
    case "cipher_reveal":
      return state.cipher === frame.cipher ? state : { ...state, cipher: frame.cipher };
    case "arrival":
      return state.arrived ? state : { ...state, arrived: true };
    case "coverage_lost":
      return state.coverageLost === true ? state : { ...state, coverageLost: true };
    case "coverage_restored":
      return state.coverageLost === false ? state : { ...state, coverageLost: false };
    default:
      // Events, not state: task_unlocked and task_completed change server data
      // the caller refetches, and a rest_lock ends when its task is submitted,
      // which no frame announces — kept here it would read as locked all day.
      // The caller's onFrame acts on each.
      return state;
  }
}

const FRAME_TYPES = new Set<string>([
  "start_signal",
  "cipher_reveal",
  "task_unlocked",
  "task_completed",
  "rest_lock",
  "trivia",
  "arrival",
  "coverage_lost",
  "coverage_restored",
]);

/** A frame this app knows, or null for anything else — including a type it has not learned yet. */
export function parseSessionFrame(raw: string): SessionFrame | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const type = (data as { type?: unknown }).type;

  return typeof type === "string" && FRAME_TYPES.has(type) ? (data as SessionFrame) : null;
}

export interface SessionSocketOptions {
  /** Every frame this app knows, after it has been reduced. */
  onFrame?: (frame: SessionFrame) => void;
  /**
   * After a reconnect — not the first open — so the caller can refetch what it
   * may have missed. The hub sends no history.
   */
  onReconnect?: () => void;
}

/**
 * Listens to this phone's `session:{id}` topic for as long as the phone holds
 * a team token.
 *
 * Reconnects with backoff, because a car spends the day dropping in and out of
 * coverage. The token is read from the store on every attempt, and the socket
 * closes the moment the store forgets it — a 401 anywhere does that — so a
 * socket never outlives the credential it opened with.
 */
export function useSessionSocket(sessionId: string | null, options: SessionSocketOptions = {}): SessionSocketState {
  const hasToken = useSessionStore((state) => state.token !== null);
  const [state, dispatch] = useReducer(sessionSocketReducer, initialSessionSocket);

  // The callbacks change identity on every render; the socket must not.
  const onFrameRef = useRef(options.onFrame);
  const onReconnectRef = useRef(options.onReconnect);
  useEffect(() => {
    onFrameRef.current = options.onFrame;
    onReconnectRef.current = options.onReconnect;
  });

  useEffect(() => {
    if (!sessionId || !hasToken) {
      return undefined;
    }

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let hasOpened = false;
    // Guards every handler: cleanup closes the old socket, and its onclose can
    // land after this effect has been torn down.
    let disposed = false;

    const connect = (): void => {
      if (disposed) return;
      const token = useSessionStore.getState().token;
      if (!token) return; // Forgotten; the effect re-runs if a new one arrives.

      const next = new WebSocket(`${WS_URL}?topic=session:${encodeURIComponent(sessionId)}`, [
        BEARER_SUBPROTOCOL,
        token,
      ]);
      socket = next;

      next.onopen = () => {
        if (disposed) return;
        attempt = 0;
        dispatch({ type: "opened" });
        if (hasOpened) {
          onReconnectRef.current?.();
        }
        hasOpened = true;
      };

      next.onmessage = (event: MessageEvent<string>) => {
        if (disposed) return;
        const frame = parseSessionFrame(event.data);
        if (!frame) {
          console.warn("Ignored a session frame this app does not understand");
          return;
        }
        dispatch({ type: "frame", frame });
        onFrameRef.current?.(frame);
      };

      // The close handler reconnects; an error always precedes a close.
      next.onerror = () => {};

      next.onclose = () => {
        if (disposed) return;
        dispatch({ type: "closed" });
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      // 1000: the server drops the subscription on a clean close.
      socket?.close(1000, "leaving the session");
      dispatch({ type: "closed" });
    };
  }, [sessionId, hasToken]);

  return state;
}
