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

import {
  CalendarDays,
  ClipboardList,
  Car,
  Flag,
  Route,
  Trophy,
  Video,
} from "@wso2/oxygen-ui-icons-react";
import type { ComponentType } from "react";

export interface NavItem {
  /** Matches the first path segment, which is how the active item is resolved. */
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ size?: number }>;
  /** False while the feature is still to be built (see the webapp plan). */
  implemented: boolean;
}

/**
 * The organizer navigation, in rally lifecycle order: set the event up, lay out
 * its routes and tasks, provision the field, then watch it run and review it.
 * This is the A1–A8 wireframe order and should not be re-sorted alphabetically.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "events", label: "Events", path: "/events", icon: CalendarDays, implemented: true },
  { id: "routes", label: "Routes", path: "/routes", icon: Route, implemented: false },
  { id: "tasks", label: "Tasks", path: "/tasks", icon: ClipboardList, implemented: false },
  { id: "vehicles", label: "Vehicles", path: "/vehicles", icon: Car, implemented: false },
  { id: "monitor", label: "Live Monitor", path: "/monitor", icon: Flag, implemented: false },
  { id: "leaderboard", label: "Leaderboard", path: "/leaderboard", icon: Trophy, implemented: false },
  { id: "debrief", label: "Debrief", path: "/debrief", icon: Video, implemented: false },
];
