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
  type UseMutationResult,
} from "@tanstack/react-query";
import { useAuthApiClient } from "@hooks/useAuthApiClient";
import { ApiQueryKeys } from "@constants/apiConstants";
import type {
  CreateEventRequest,
  RallyEvent,
  UpdateEventRequest,
} from "@/types/event";

/**
 * Creates an event (A2 setup, first save). The event starts in `setup`; only
 * publish makes it runnable.
 *
 * @returns {UseMutationResult<RallyEvent, Error, CreateEventRequest>} The create mutation.
 */
export function useCreateEvent(): UseMutationResult<
  RallyEvent,
  Error,
  CreateEventRequest
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<RallyEvent, Error, CreateEventRequest>({
    mutationFn: (body) =>
      authJson<RallyEvent>("/events", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [ApiQueryKeys.EVENTS] });
    },
  });
}

export interface UpdateEventVariables {
  eventId: string;
  body: UpdateEventRequest;
}

/**
 * Patches an event (A2 setup, subsequent saves).
 *
 * @returns {UseMutationResult<RallyEvent, Error, UpdateEventVariables>} The update mutation.
 */
export function useUpdateEvent(): UseMutationResult<
  RallyEvent,
  Error,
  UpdateEventVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<RallyEvent, Error, UpdateEventVariables>({
    mutationFn: ({ eventId, body }) =>
      authJson<RallyEvent>(`/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (updated) => {
      // Seed the detail cache from the response so the form does not flash
      // stale values while a refetch is in flight.
      queryClient.setQueryData([ApiQueryKeys.EVENT, updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: [ApiQueryKeys.EVENTS] });
    },
  });
}

/**
 * Publishes an event, moving it from `setup` to `active` and opening it to crews.
 *
 * The backend rejects this with a 400 unless both geofences are placed, so the
 * caller must surface the returned message rather than assume success.
 *
 * @returns {UseMutationResult<RallyEvent, Error, string>} The publish mutation.
 */
export function usePublishEvent(): UseMutationResult<RallyEvent, Error, string> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<RallyEvent, Error, string>({
    mutationFn: (eventId) =>
      authJson<RallyEvent>(`/events/${eventId}/publish`, { method: "POST" }),
    onSuccess: (published) => {
      queryClient.setQueryData([ApiQueryKeys.EVENT, published.id], published);
      void queryClient.invalidateQueries({ queryKey: [ApiQueryKeys.EVENTS] });
    },
  });
}
