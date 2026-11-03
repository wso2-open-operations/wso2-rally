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

/**
 * Whether the map's imagery is loading, judged from the tile layer's own
 * events.
 *
 * Tiles are the only part of the route screen that needs the network, and the
 * part that matters least: the position, the distance and the geofences are
 * all in hand without them. So a failure only ever hides the backdrop. One
 * failed tile is a missing square, not an outage; two in a row with nothing
 * loading between them is. The first tile that loads afterwards heals it, so
 * coverage returning fixes the screen without a reload.
 */
export interface TileHealth {
  available: boolean;
  /** Failures since the last tile that loaded. */
  consecutiveErrors: number;
}

export type TileEvent = "errored" | "loaded";

/** Failures in a row that mean the imagery is gone. */
const OUTAGE_AFTER = 2;

export const initialTileHealth: TileHealth = { available: true, consecutiveErrors: 0 };

export function tileHealthReducer(state: TileHealth, event: TileEvent): TileHealth {
  if (event === "loaded") {
    return state.available && state.consecutiveErrors === 0 ? state : initialTileHealth;
  }
  const consecutiveErrors = state.consecutiveErrors + 1;

  return { available: consecutiveErrors < OUTAGE_AFTER, consecutiveErrors };
}
