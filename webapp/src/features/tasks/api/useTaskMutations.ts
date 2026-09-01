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
import type { CreateTaskRequest, RallyTask, UpdateTaskRequest } from "@/types/task";

export interface CreateTaskVariables {
  eventId: string;
  body: CreateTaskRequest;
}

/**
 * Authors a new task in an event's library.
 *
 * @returns {UseMutationResult<RallyTask, Error, CreateTaskVariables>} The create mutation.
 */
export function useCreateTask(): UseMutationResult<
  RallyTask,
  Error,
  CreateTaskVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<RallyTask, Error, CreateTaskVariables>({
    mutationFn: ({ eventId, body }) =>
      authJson<RallyTask>(`/events/${eventId}/tasks`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_task, { eventId }) => {
      void queryClient.invalidateQueries({ queryKey: [ApiQueryKeys.TASKS, eventId] });
    },
  });
}

export interface UpdateTaskVariables {
  taskId: string;
  /** Carried only to invalidate the right library; the path uses the task id. */
  eventId: string;
  body: UpdateTaskRequest;
}

/**
 * Retunes an existing task.
 *
 * The backend re-validates the whole task after applying the patch, so an edit
 * can never leave a definition the engine cannot score.
 *
 * @returns {UseMutationResult<RallyTask, Error, UpdateTaskVariables>} The update mutation.
 */
export function useUpdateTask(): UseMutationResult<
  RallyTask,
  Error,
  UpdateTaskVariables
> {
  const { authJson } = useAuthApiClient();
  const queryClient = useQueryClient();

  return useMutation<RallyTask, Error, UpdateTaskVariables>({
    mutationFn: ({ taskId, body }) =>
      authJson<RallyTask>(`/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (_task, { eventId }) => {
      void queryClient.invalidateQueries({ queryKey: [ApiQueryKeys.TASKS, eventId] });
    },
  });
}
