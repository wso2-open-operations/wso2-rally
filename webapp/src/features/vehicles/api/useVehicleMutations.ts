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
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useAuthApiClient } from "@hooks/useAuthApiClient";
import { ApiQueryKeys } from "@constants/apiConstants";
import type {
  CreateVehicleRequest,
  ImportResult,
  UpdateVehicleRequest,
  Vehicle,
} from "@/types/vehicle";

/**
 * Drops every cached page of an event's fleet.
 *
 * The key carries the filter and page window, so invalidating the prefix is the
 * only way to catch the page the organizer is looking at *and* the ones behind
 * it — a create can change which vehicles land on which page.
 */
function invalidateFleet(queryClient: QueryClient, eventId: string): void {
  void queryClient.invalidateQueries({ queryKey: [ApiQueryKeys.VEHICLES, eventId] });
  // The dashboard counts vehicles and crews, so it is stale now too.
  void queryClient.invalidateQueries({ queryKey: [ApiQueryKeys.EVENT_STATS, eventId] });
}

export interface CreateVehicleVariables {
  eventId: string;
  body: CreateVehicleRequest;
}

/**
 * Provisions a vehicle and its crew in one call.
 *
 * @returns {UseMutationResult<Vehicle, Error, CreateVehicleVariables>} The create mutation.
 */
export function useCreateVehicle(): UseMutationResult<
  Vehicle,
  Error,
  CreateVehicleVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<Vehicle, Error, CreateVehicleVariables>({
    mutationFn: ({ eventId, body }) =>
      authJson<Vehicle>(`/events/${eventId}/vehicles`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_vehicle, { eventId }) => invalidateFleet(queryClient, eventId),
  });
}

export interface UpdateVehicleVariables {
  vehicleId: string;
  /** Carried only to invalidate the right fleet; the path uses the vehicle id. */
  eventId: string;
  body: UpdateVehicleRequest;
}

/**
 * Edits a vehicle. A supplied `crew` replaces the whole roster, and the
 * replacements get new ids — which is why the form always sends the full list.
 *
 * @returns {UseMutationResult<Vehicle, Error, UpdateVehicleVariables>} The update mutation.
 */
export function useUpdateVehicle(): UseMutationResult<
  Vehicle,
  Error,
  UpdateVehicleVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<Vehicle, Error, UpdateVehicleVariables>({
    mutationFn: ({ vehicleId, body }) =>
      authJson<Vehicle>(`/vehicles/${vehicleId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (_vehicle, { eventId }) => invalidateFleet(queryClient, eventId),
  });
}

export interface DeleteVehicleVariables {
  vehicleId: string;
  eventId: string;
}

/**
 * Removes a vehicle that should not have been provisioned.
 *
 * The backend refuses with a 409 once the vehicle has a session, because its
 * score, submissions and alerts would cascade away with it.
 *
 * @returns {UseMutationResult<void, Error, DeleteVehicleVariables>} The delete mutation.
 */
export function useDeleteVehicle(): UseMutationResult<
  void,
  Error,
  DeleteVehicleVariables
> {
  const { authFetch } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, Error, DeleteVehicleVariables>({
    mutationFn: async ({ vehicleId }) => {
      await authFetch(`/vehicles/${vehicleId}`, { method: "DELETE" });
    },
    onSuccess: (_result, { eventId }) => invalidateFleet(queryClient, eventId),
  });
}

export interface ImportVehiclesVariables {
  eventId: string;
  file: File;
}

/**
 * Provisions a fleet from a spreadsheet.
 *
 * The body is `multipart/form-data` with a field named `file`; the client
 * deliberately leaves `Content-Type` unset for a `FormData` body so the browser
 * supplies the boundary. The import is all-or-nothing server-side, so a
 * rejected file leaves nothing half-provisioned.
 *
 * @returns {UseMutationResult<ImportResult, Error, ImportVehiclesVariables>} The import mutation.
 */
export function useImportVehiclesCsv(): UseMutationResult<
  ImportResult,
  Error,
  ImportVehiclesVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<ImportResult, Error, ImportVehiclesVariables>({
    mutationFn: ({ eventId, file }) => {
      const form = new FormData();
      form.append("file", file);

      return authJson<ImportResult>(`/events/${eventId}/vehicles/import`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (_result, { eventId }) => invalidateFleet(queryClient, eventId),
  });
}
