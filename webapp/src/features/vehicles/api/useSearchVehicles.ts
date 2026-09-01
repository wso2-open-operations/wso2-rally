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

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAsgardeo } from "@asgardeo/react";
import { useAuthApiClient } from "@hooks/useAuthApiClient";
import { ApiQueryKeys, DEFAULT_PAGE_SIZE } from "@constants/apiConstants";
import type { SearchResult } from "@/types/common";
import type { SearchVehiclesRequest, Vehicle } from "@/types/vehicle";

export interface VehicleSearchArgs {
  eventId: string | undefined;
  /** Matches a vehicle code or team name; empty matches the whole fleet. */
  query?: string;
  routeId?: string;
  offset?: number;
  limit?: number;
}

/**
 * Reads a page of an event's fleet (A5).
 *
 * The fleet runs to ~150 cars, so unlike the fifteen-row task library this one
 * really is paged, and the filters are pushed to the server — the total has to
 * count what matched, not the whole fleet, for the pager to be honest.
 *
 * @param {VehicleSearchArgs} args - The event, filters and page window.
 * @returns {UseQueryResult<SearchResult<Vehicle>, Error>} The vehicle page.
 */
export function useSearchVehicles({
  eventId,
  query = "",
  routeId = "",
  offset = 0,
  limit = DEFAULT_PAGE_SIZE,
}: VehicleSearchArgs): UseQueryResult<SearchResult<Vehicle>, Error> {
  const { authJson } = useAuthApiClient();
  const { isSignedIn, isLoading: isAuthLoading } = useAsgardeo();

  return useQuery<SearchResult<Vehicle>, Error>({
    queryKey: [ApiQueryKeys.VEHICLES, eventId, { query, routeId, offset, limit }],
    queryFn: () => {
      const body: SearchVehiclesRequest = {
        offset,
        limit,
        filters: { query, routeId },
      };

      return authJson<SearchResult<Vehicle>>(`/events/${eventId}/vehicles/search`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    enabled: Boolean(eventId) && isSignedIn && !isAuthLoading,
    // A filter change should not blank the table while the next page loads.
    placeholderData: (previous) => previous,
  });
}
