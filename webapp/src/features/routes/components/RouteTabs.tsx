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

import { type JSX } from "react";
import { Box, Chip, Skeleton } from "@wso2/oxygen-ui";
import type { RallyRoute } from "@/types/route";

export interface RouteTabsProps {
  routes: RallyRoute[];
  selectedRouteId: string | undefined;
  isLoading: boolean;
  onSelect: (routeId: string) => void;
}

/**
 * The route switcher — "Route 1 · Inland", "Route 2 · Wetlands".
 *
 * Chips rather than tabs: an event has two courses, and the wireframe puts them
 * inline with the page title rather than in a tab strip.
 *
 * @param {RouteTabsProps} props - The event's routes and the current selection.
 * @returns {JSX.Element} The route chips.
 */
export default function RouteTabs({
  routes,
  selectedRouteId,
  isLoading,
  onSelect,
}: RouteTabsProps): JSX.Element {
  if (isLoading) {
    return (
      <Box sx={{ display: "flex", gap: 1 }}>
        <Skeleton height={32} variant="rounded" width={120} />
        <Skeleton height={32} variant="rounded" width={120} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      {routes.map((route, index) => (
        <Chip
          color={route.id === selectedRouteId ? "primary" : "default"}
          key={route.id}
          label={`Route ${index + 1} · ${route.name}`}
          onClick={() => onSelect(route.id)}
          variant={route.id === selectedRouteId ? "filled" : "outlined"}
        />
      ))}
    </Box>
  );
}
