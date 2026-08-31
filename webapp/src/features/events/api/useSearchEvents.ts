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
import { useLogger } from "@hooks/useLogger";
import { ApiQueryKeys, DEFAULT_PAGE_SIZE } from "@constants/apiConstants";
import type { SearchResult } from "@/types/common";
import type { EventStatus, RallyEvent, SearchEventsRequest } from "@/types/event";

export interface UseSearchEventsParams {
  offset?: number;
  limit?: number;
  status?: EventStatus | "";
  enabled?: boolean;
}

/**
 * Searches events (A1 dashboard table).
 *
 * @param {UseSearchEventsParams} params - Page window and status filter.
 * @returns {UseQueryResult<SearchResult<RallyEvent>, Error>} The events page.
 */
export function useSearchEvents({
  offset = 0,
  limit = DEFAULT_PAGE_SIZE,
  status = "",
  enabled = true,
}: UseSearchEventsParams = {}): UseQueryResult<SearchResult<RallyEvent>, Error> {
  const { authJson } = useAuthApiClient();
  const { isSignedIn, isLoading: isAuthLoading } = useAsgardeo();
  const logger = useLogger();

  return useQuery<SearchResult<RallyEvent>, Error>({
    queryKey: [ApiQueryKeys.EVENTS, "search", offset, limit, status],
    queryFn: () => {
      const body: SearchEventsRequest = { offset, limit, filters: { status } };
      logger.debug(`[useSearchEvents] offset=${offset} limit=${limit} status=${status || "any"}`);

      return authJson<SearchResult<RallyEvent>>("/events/search", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    enabled: enabled && isSignedIn && !isAuthLoading,
  });
}
