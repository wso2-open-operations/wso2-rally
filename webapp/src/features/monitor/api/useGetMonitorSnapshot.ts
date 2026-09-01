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
import type { MonitorSnapshot } from "@/types/monitor";

/**
 * Reads the live-monitor snapshot that seeds A6.
 *
 * The socket carries deltas and no history, so this is what a monitor opened
 * mid-rally starts from — and what a reconnect refetches, since anything
 * broadcast while the socket was down is gone.
 *
 * Not polled: the socket is the update channel, and a 30-second poll behind a
 * live feed would only fight it.
 *
 * @param {string | undefined} eventId - The event to read; idles while undefined.
 * @returns {UseQueryResult<MonitorSnapshot, Error>} The snapshot query.
 */
export function useGetMonitorSnapshot(
  eventId: string | undefined,
): UseQueryResult<MonitorSnapshot, Error> {
  const { authJson } = useAuthApiClient();
  const { isSignedIn, isLoading: isAuthLoading } = useAsgardeo();

  return useQuery<MonitorSnapshot, Error>({
    queryKey: [ApiQueryKeys.MONITOR, eventId],
    queryFn: () => authJson<MonitorSnapshot>(`/events/${eventId}/monitor`),
    enabled: Boolean(eventId) && isSignedIn && !isAuthLoading,
  });
}
