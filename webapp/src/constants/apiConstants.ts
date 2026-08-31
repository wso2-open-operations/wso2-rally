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
 * Query-key roots, kept in one place so a mutation can invalidate exactly the
 * caches it touched without guessing at string literals.
 */
export const ApiQueryKeys = {
  CURRENT_USER: "current-user",
  EVENTS: "events",
  EVENT: "event",
  EVENT_STATS: "event-stats",
  ROUTES: "routes",
  TASKS: "tasks",
  VEHICLES: "vehicles",
  ALERTS: "alerts",
  LEADERBOARD: "leaderboard",
  MONITOR: "monitor",
  DEBRIEF: "debrief",
} as const;

/**
 * Asgardeo SPA SDK error code raised when `getIdToken()` runs before the auth
 * client is ready. It is the only failure `authFetch` treats as recoverable.
 */
export const ASGARDEO_UNAUTHENTICATED_CODE = "SPA-AUTH_CLIENT-VM-IV02";

/** Default page window for every `POST /<resource>/search` call. */
export const DEFAULT_PAGE_SIZE = 20;
