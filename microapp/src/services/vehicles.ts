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
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

import { queryOptions } from "@tanstack/react-query";
import { SESSIONS_JOINABLE } from "@config/endpoints";
import { apiClient } from "@services/apiClient";
import { getSuperAppToken } from "@services/auth";
import type { JoinableVehicleDTO } from "@/types/session.dto";
import type { JoinableVehicle } from "@/types/session.model";

/**
 * The cars the signed-in person can join: those, in published events, whose
 * crew list includes their email.
 *
 * Read before joining, so it carries the **super app's** token — there is no
 * team token yet, and a stale one from an earlier run must not be sent in its
 * place. The backend filters to the caller, so this is usually one car, and an
 * empty list means the person is on no crew at all.
 */
export async function listJoinableVehicles(): Promise<JoinableVehicle[]> {
  const superAppToken = await getSuperAppToken();
  const { data } = await apiClient.get<JoinableVehicleDTO[] | null>(SESSIONS_JOINABLE, {
    headers: { Authorization: `Bearer ${superAppToken}` },
  });

  return (data ?? []).map((dto) => ({
    vehicleId: dto.vehicleId,
    code: dto.code,
    teamName: dto.teamName,
    eventId: dto.eventId,
    eventName: dto.eventName,
    eventDate: dto.eventDate,
    startTime: dto.startTime,
  }));
}

export const vehicleKeys = {
  all: ["vehicles"] as const,
  joinable: () => [...vehicleKeys.all, "joinable"] as const,
};

export const vehicles = {
  joinable: () => queryOptions({ queryKey: vehicleKeys.joinable(), queryFn: listJoinableVehicles }),
};
