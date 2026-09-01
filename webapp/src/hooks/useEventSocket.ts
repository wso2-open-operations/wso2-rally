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

import { useEffect, useRef, useState } from "react";
import { useAsgardeo } from "@asgardeo/react";
import { getWebSocketUrl } from "@config/apiConfig";
import { useLogger } from "@hooks/useLogger";

/**
 * The subprotocol marking the token that follows it, mirroring
 * `authz.BearerSubprotocol`.
 *
 * A browser cannot set a header on a WebSocket handshake, and the token must not
 * go in the query string, where it would land in the backend's request log and
 * the browser's history. `new WebSocket(url, [marker, token])` is the only
 * channel left.
 */
export const BEARER_SUBPROTOCOL = "rally-bearer";

/** Reconnect backoff, in milliseconds. The last value repeats. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export interface EventSocket {
  /** True while a socket is open and negotiated. */
  connected: boolean;
  /**
   * True once a connection has dropped and not yet been re-established. The UI
   * shows stale data with a warning rather than blanking the map.
   */
  reconnecting: boolean;
}

export interface EventSocketOptions {
  /** Called for every frame received, verbatim. Parsing is the caller's job. */
  onMessage: (raw: string) => void;
  /**
   * Called after a reconnect, so the caller can refetch the REST snapshot — the
   * hub sends no history, and anything broadcast while the socket was down is
   * gone for good.
   */
  onReconnect?: () => void;
}

/**
 * Subscribes to an event's live topic (`event:{id}`).
 *
 * Reconnects with backoff, because a rally runs for hours on hotel wifi and a
 * monitor that gives up after one drop is worse than useless. The token is
 * re-read on every attempt: a reconnect two hours in must not replay an id
 * token that expired an hour ago.
 *
 * @param {string | undefined} eventId - The event to watch; idles while undefined.
 * @param {EventSocketOptions} options - Frame and reconnect callbacks.
 * @returns {EventSocket} The connection state.
 */
export function useEventSocket(
  eventId: string | undefined,
  { onMessage, onReconnect }: EventSocketOptions,
): EventSocket {
  const { getIdToken, isSignedIn } = useAsgardeo();
  const logger = useLogger();

  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // Everything the effect uses but must not re-run for lives in a ref.
  //
  // This is load-bearing, not tidiness: `useAsgardeo()` hands back a fresh
  // `getIdToken` on every render, so depending on its identity tore the socket
  // down and rebuilt it on each one — a reconnect storm that also lost every
  // frame in between.
  const onMessageRef = useRef(onMessage);
  const onReconnectRef = useRef(onReconnect);
  const getIdTokenRef = useRef(getIdToken);
  const loggerRef = useRef(logger);

  // After render, not during it: a ref written mid-render is a render that
  // depends on mutation. The initial values come from `useRef` above, so the
  // socket effect below always reads something valid on mount.
  useEffect(() => {
    onMessageRef.current = onMessage;
    onReconnectRef.current = onReconnect;
    getIdTokenRef.current = getIdToken;
    loggerRef.current = logger;
  });

  useEffect(() => {
    if (!eventId || !isSignedIn) {
      return undefined;
    }

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let hasConnectedOnce = false;
    // Guards every async continuation: without it, a token fetch that resolves
    // after unmount would open a socket nothing will ever close.
    let disposed = false;

    const scheduleRetry = (): void => {
      if (disposed) return;

      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      setReconnecting(true);
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async (): Promise<void> => {
      if (disposed) return;

      let token: string;
      try {
        token = await getIdTokenRef.current();
      } catch (error) {
        loggerRef.current.error("could not read the id token for the live socket", error);
        scheduleRetry();

        return;
      }
      if (disposed || !token) {
        if (!token) scheduleRetry();

        return;
      }

      const url = `${getWebSocketUrl()}?topic=event:${encodeURIComponent(eventId)}`;
      const next = new WebSocket(url, [BEARER_SUBPROTOCOL, token]);
      socket = next;

      next.onopen = () => {
        if (disposed) return;

        attempt = 0;
        setConnected(true);
        setReconnecting(false);
        // Not on the first open: the caller has just loaded the snapshot, and
        // refetching it immediately would be a wasted round trip.
        if (hasConnectedOnce) {
          onReconnectRef.current?.();
        }
        hasConnectedOnce = true;
      };

      next.onmessage = (frame: MessageEvent<string>) => {
        if (!disposed) {
          onMessageRef.current(frame.data);
        }
      };

      next.onerror = () => {
        // The close handler does the reconnecting; an error always precedes one.
        loggerRef.current.debug("live socket error");
      };

      next.onclose = (closeEvent: CloseEvent) => {
        setConnected(false);
        if (disposed) return;

        loggerRef.current.debug("live socket closed", closeEvent.code, closeEvent.reason);
        scheduleRetry();
      };
    };

    void connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      setConnected(false);
      setReconnecting(false);
      // 1000 Normal Closure: the server unsubscribes this topic on read
      // cancellation, so a clean close keeps no ghost subscriber behind.
      socket?.close(1000, "leaving the monitor");
    };
  }, [eventId, isSignedIn]);

  return { connected, reconnecting };
}
