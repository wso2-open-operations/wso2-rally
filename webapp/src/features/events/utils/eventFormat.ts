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

import { NULL_PLACEHOLDER } from "@constants/common";
import type { EventStatus, RouteRef } from "@/types/event";

/**
 * Formats the stored `HH:MM` wall-clock start for display.
 *
 * The value is a literal wall-clock time, not an instant, so it is formatted by
 * hand — feeding it through `Date` would shift it by the viewer's time zone.
 *
 * @param {string} startTime - The start time as `HH:MM`.
 * @returns {string} A 12-hour rendering, e.g. "09:00 AM".
 */
export function formatStartTime(startTime: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (!match) {
    return startTime || NULL_PLACEHOLDER;
  }

  const hours = Number(match[1]);
  if (hours > 23) {
    return startTime;
  }

  const suffix = hours < 12 ? "AM" : "PM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;

  return `${String(displayHours).padStart(2, "0")}:${match[2]} ${suffix}`;
}

/**
 * Joins an event's route names the way the A1 table shows them.
 *
 * @param {RouteRef[]} routes - The event's routes.
 * @returns {string} e.g. "Inland + Wetlands", or the null placeholder.
 */
export function formatRouteNames(routes: RouteRef[]): string {
  if (routes.length === 0) {
    return NULL_PLACEHOLDER;
  }

  return routes.map((route) => route.name).join(" + ");
}

/** Human label for a status chip. */
export const STATUS_LABELS: Record<EventStatus, string> = {
  setup: "Setup",
  active: "Active",
  complete: "Complete",
};

/** Chip colour per status: amber while unpublished, green once it has run. */
export const STATUS_COLORS: Record<EventStatus, "warning" | "info" | "success"> = {
  setup: "warning",
  active: "info",
  complete: "success",
};
