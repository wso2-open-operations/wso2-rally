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

import { useCallback, useEffect, useRef, useState } from "react";
import { watchPosition, type Position, type PositionFailure } from "@sensors/position";
import { ping } from "@services/session";
import type { PingResult } from "@/types/session.model";

export interface LocationReporter {
  /** This phone is reporting: started, and the position source has not failed. */
  sharing: boolean;
  /** The latest fix, or null before the first one and after a failure. */
  position: Position | null;
  /** Why no fix is coming, until a new one arrives or `start` asks again. */
  failure: PositionFailure | null;
  /** Why the last ping did not land; cleared by the next one that does. */
  pingError: string | null;
  /** Starts reporting from this phone, or asks the position source again after a failure. */
  start: () => void;
}

export interface LocationReporterOptions {
  /** Report without waiting for `start` — the car is already under way. */
  autoStart?: boolean;
  /** The run has finished: report nothing, whatever was started. The backend refuses it anyway. */
  runOver?: boolean;
  /** Every answer the backend gives: what the fix unlocked, and where the car now is. */
  onResult?: (result: PingResult) => void;
}

/**
 * Streams this phone's position to `POST /sessions/me/location`.
 *
 * Geofencing is the server's: this reports where the phone is and hands back
 * what the server decided. Any phone in the car may report, and the car stays
 * covered only while at least one does, so this lives above the screens and
 * keeps going from B4 into a task and back.
 *
 * One ping is in flight at a time. A live fix that lands meanwhile replaces the
 * live fix already waiting — on a slow link the stream outruns the requests,
 * and the in-between positions add nothing the newest does not. A **buffered**
 * fix is never dropped: the super app recorded it while the driver was in
 * Google Maps, any one of them may cross a geofence, and each goes with the
 * time it was taken (BE-20).
 */
export function useLocationReporter({
  autoStart = false,
  runOver = false,
  onResult,
}: LocationReporterOptions = {}): LocationReporter {
  const [started, setStarted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [position, setPosition] = useState<Position | null>(null);
  const [failure, setFailure] = useState<PositionFailure | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);

  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  const enabled = (started || autoStart) && !runOver;

  useEffect(() => {
    if (!enabled) return undefined;

    const waiting: Position[] = [];
    let inFlight = false;
    let disposed = false;

    const pump = (): void => {
      if (disposed || inFlight) return;
      const next = waiting.shift();
      if (!next) return;

      inFlight = true;
      ping(next)
        .then((result) => {
          if (disposed) return;
          setPingError(null);
          onResultRef.current?.(result);
        })
        .catch((error: unknown) => {
          if (disposed) return;
          // Not retried: the next fix is a newer position, and the backend only
          // needs the latest. The crew is told, so a dead link is not silent.
          setPingError(error instanceof Error ? error.message : "Could not report the car's position.");
        })
        .finally(() => {
          inFlight = false;
          pump();
        });
    };

    const stop = watchPosition(
      (fix) => {
        setPosition(fix);
        setFailure(null);
        const last = waiting[waiting.length - 1];
        if (!fix.buffered && last && !last.buffered) {
          waiting[waiting.length - 1] = fix;
        } else {
          waiting.push(fix);
        }
        pump();
      },
      (reason) => {
        // A fix from before the source went quiet is no evidence of where the car is.
        setPosition(null);
        setFailure(reason);
      },
    );

    return () => {
      disposed = true;
      stop();
    };
  }, [enabled, attempt]);

  // `start` is stable, so a screen can call it on mount without a failure
  // re-running its effect — that would retry a refused permission in a loop.
  const failureRef = useRef(failure);
  useEffect(() => {
    failureRef.current = failure;
  }, [failure]);

  const start = useCallback(() => {
    setStarted(true);
    // Already running and healthy: nothing to ask again.
    if (failureRef.current !== null) {
      failureRef.current = null;
      setFailure(null);
      setAttempt((n) => n + 1);
    }
  }, []);

  return { sharing: enabled && failure === null, position, failure, pingError, start };
}
