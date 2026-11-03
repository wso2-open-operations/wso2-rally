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

import { useCallback, useEffect, useState } from "react";
import { watchPosition, type Position, type PositionFailure } from "@sensors/position";
import { haversineMeters, pointInRadius, type LatLng } from "@utils/geo";

export interface Geofence {
  /** False until a fix lands within the radius — and whenever there is no centre or no fix. */
  inside: boolean;
  /** From the latest fix to the centre; null without either. */
  distanceM: number | null;
  /** The latest fix, or null before the first one and after a failure. */
  position: Position | null;
  /** Why no fix is coming, until a new one arrives or `retry` is called. */
  failure: PositionFailure | null;
  /** Asks the position source again — after the crew has, say, allowed location in settings. */
  retry: () => void;
}

/**
 * Where this phone is relative to a circle, live.
 *
 * Watches the position for as long as the screen is mounted. A failure drops
 * the last fix rather than keeping it: a position from before the source went
 * quiet is no evidence of where the car is now, and nothing may unlock on it.
 * With no centre there is nothing to be inside of, so the answer is no.
 */
export function useGeofence(center: LatLng | null, radiusM: number): Geofence {
  const [position, setPosition] = useState<Position | null>(null);
  const [failure, setFailure] = useState<PositionFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    return watchPosition(
      (next) => {
        setPosition(next);
        setFailure(null);
      },
      (reason) => {
        setPosition(null);
        setFailure(reason);
      },
    );
  }, [attempt]);

  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  const distanceM = position && center ? haversineMeters(position, center) : null;
  const inside = position !== null && center !== null && pointInRadius(position, center, radiusM);

  return { inside, distanceM, position, failure, retry };
}
