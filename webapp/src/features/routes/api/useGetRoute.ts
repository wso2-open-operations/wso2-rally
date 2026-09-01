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
import type { RallyRoute } from "@/types/route";

/**
 * Reads one route with its waypoints in driving order, each carrying the ids of
 * the tasks attached to it (A3).
 *
 * @param {string | undefined} routeId - The route to read; idles while undefined.
 * @returns {UseQueryResult<RallyRoute, Error>} The route query.
 */
export function useGetRoute(
  routeId: string | undefined,
): UseQueryResult<RallyRoute, Error> {
  const { authJson } = useAuthApiClient();
  const { isSignedIn, isLoading: isAuthLoading } = useAsgardeo();

  return useQuery<RallyRoute, Error>({
    queryKey: [ApiQueryKeys.ROUTES, "detail", routeId],
    queryFn: () => authJson<RallyRoute>(`/routes/${routeId}`),
    enabled: Boolean(routeId) && isSignedIn && !isAuthLoading,
  });
}
