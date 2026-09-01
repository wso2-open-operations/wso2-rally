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

import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { useAuthApiClient } from "@hooks/useAuthApiClient";
import { csvFilename, downloadBlob } from "@utils/csv";

export interface ExportVehiclesVariables {
  eventId: string;
  /** Stamped into the filename so two exports in a day stay tellable apart. */
  eventName?: string;
}

/**
 * Downloads the event's fleet as a CSV.
 *
 * A mutation rather than a query: it is an action with a side effect on the
 * user's disk, and caching a file the organizer asked for once would be wrong.
 *
 * The request cannot be an `<a href>` or a new tab — the endpoint needs the
 * organizer's bearer token, and a browser-initiated navigation would arrive
 * unauthenticated. It is fetched through the API client and handed to the
 * browser as a blob instead.
 *
 * @returns {UseMutationResult<void, Error, ExportVehiclesVariables>} The export mutation.
 */
export function useExportVehiclesCsv(): UseMutationResult<
  void,
  Error,
  ExportVehiclesVariables
> {
  const { authFetch } = useAuthApiClient();

  return useMutation<void, Error, ExportVehiclesVariables>({
    mutationFn: async ({ eventId, eventName }) => {
      const response = await authFetch(`/events/${eventId}/vehicles/export`);
      const blob = await response.blob();

      const slug = (eventName ?? "vehicles")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      downloadBlob(blob, csvFilename(slug || "vehicles"));
    },
  });
}
