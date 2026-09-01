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
import { ApiQueryKeys } from "@constants/apiConstants";
import type { SearchResult } from "@/types/common";
import type { RallyTask, SearchTasksRequest } from "@/types/task";

// The library is fifteen tasks by design, so the page fetches the lot rather
// than paginating a list an organizer wants to read end to end. 100 is the
// server-side cap.
const TASK_PAGE_SIZE = 100;

/**
 * Reads an event's task library (A4).
 *
 * @param {string | undefined} eventId - The event whose tasks to list; idles while undefined.
 * @returns {UseQueryResult<SearchResult<RallyTask>, Error>} The task page.
 */
export function useSearchTasks(
  eventId: string | undefined,
): UseQueryResult<SearchResult<RallyTask>, Error> {
  const { authJson } = useAuthApiClient();
  const { isSignedIn, isLoading: isAuthLoading } = useAsgardeo();

  return useQuery<SearchResult<RallyTask>, Error>({
    queryKey: [ApiQueryKeys.TASKS, eventId],
    queryFn: () => {
      const body: SearchTasksRequest = { offset: 0, limit: TASK_PAGE_SIZE };

      return authJson<SearchResult<RallyTask>>(`/events/${eventId}/tasks/search`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    enabled: Boolean(eventId) && isSignedIn && !isAuthLoading,
  });
}
