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

import "@config/portalConfig";

export interface MapConfig {
  tileUrl: string;
  attribution: string;
  /** Where the picker opens before an organizer has dropped a pin. */
  defaultCenter: { lat: number; lng: number };
  defaultZoom: number;
}

// OpenStreetMap needs no API key, which is why the spec picks it. These are
// only defaults — a deployment behind a corporate tile proxy overrides them in
// config.js without a rebuild.
const DEFAULT_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
// Colombo — the rally start is in the Western Province, so an unplaced map
// opens somewhere the organizer recognises rather than at 0,0.
const DEFAULT_LAT = 6.9271;
const DEFAULT_LNG = 79.8612;
const DEFAULT_ZOOM = 11;

/**
 * Reads the map tile settings.
 *
 * Unlike the backend and auth configs this one never throws: maps are cosmetic
 * enough that a missing override should fall back, not block the whole app.
 *
 * @returns {MapConfig} The resolved map configuration.
 */
export function getMapConfig(): MapConfig {
  const config = window.config;

  return {
    tileUrl: config?.RALLY_MAP_TILE_URL || DEFAULT_TILE_URL,
    attribution: config?.RALLY_MAP_ATTRIBUTION || DEFAULT_ATTRIBUTION,
    defaultCenter: {
      lat: config?.RALLY_MAP_DEFAULT_LAT ?? DEFAULT_LAT,
      lng: config?.RALLY_MAP_DEFAULT_LNG ?? DEFAULT_LNG,
    },
    defaultZoom: config?.RALLY_MAP_DEFAULT_ZOOM ?? DEFAULT_ZOOM,
  };
}
