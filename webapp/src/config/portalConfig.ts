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

/**
 * Shape of `window.config`, loaded from `public/config.js` before the bundle.
 *
 * Runtime, not build-time: the same `dist/` is promoted across environments and
 * only `config.js` is swapped. Domain modules read subsets through the helpers
 * in this folder rather than touching `window.config` directly.
 */
export interface RallyWindowConfig {
  RALLY_BACKEND_BASE_URL: string;
  RALLY_ASGARDEO_BASE_URL: string;
  RALLY_ASGARDEO_CLIENT_ID: string;
  RALLY_ASGARDEO_SIGN_IN_REDIRECT_URL: string;
  RALLY_ASGARDEO_SIGN_OUT_REDIRECT_URL: string;
  RALLY_MAP_TILE_URL?: string;
  RALLY_MAP_ATTRIBUTION?: string;
  RALLY_MAP_DEFAULT_LAT?: number;
  RALLY_MAP_DEFAULT_LNG?: number;
  RALLY_MAP_DEFAULT_ZOOM?: number;
  RALLY_THEME?: string;
  RALLY_LOG_LEVEL?: string;
}

declare global {
  interface Window {
    config: RallyWindowConfig;
  }
}

export {};
