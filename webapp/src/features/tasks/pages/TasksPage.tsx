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

import { useEffect, useState, type JSX } from "react";
import { Box, Button, Typography } from "@wso2/oxygen-ui";
import { Plus } from "@wso2/oxygen-ui-icons-react";
import EventSelect from "@components/event-select/EventSelect";
import TasksTable from "@features/tasks/components/TasksTable";
import TaskEditDialog from "@features/tasks/components/TaskEditDialog";
import { useSearchTasks } from "@features/tasks/api/useSearchTasks";
import {
  useCreateTask,
  useUpdateTask,
} from "@features/tasks/api/useTaskMutations";
import { useEventSelection } from "@hooks/useEventSelection";
import { useErrorBanner } from "@context/error-banner/useErrorBanner";
import { useSuccessBanner } from "@context/success-banner/useSuccessBanner";
import { getApiErrorMessage } from "@utils/ApiError";
import type { CreateTaskRequest, RallyTask } from "@/types/task";

/** The blank task the "+ Task" button opens the editor with. */
const newTask = (eventId: string, nextCode: string): RallyTask => ({
  id: "",
  eventId,
  code: nextCode,
  title: "",
  type: "INPUT_SELECT",
  trigger: "geofence",
  points: 50,
  sensor: "none",
  config: {},
});

/**
 * Suggests the next free T-code, so an organizer adding the fifteenth task does
 * not have to scan the list for what is taken.
 */
function nextFreeCode(tasks: RallyTask[]): string {
  const used = new Set(tasks.map((task) => task.code.toUpperCase()));
  for (let n = 1; n <= 99; n += 1) {
    if (!used.has(`T${n}`)) {
      return `T${n}`;
    }
  }

  return "";
}

/**
 * A4 — the task library.
 *
 * Tasks belong to an event, but the wireframe puts this at a top-level path, so
 * the event comes from the shared selector rather than the route.
 *
 * @returns {JSX.Element} The task library page.
 */
export default function TasksPage(): JSX.Element {
  const { showError } = useErrorBanner();
  const { showSuccess } = useSuccessBanner();
  const {
    events,
    selectedEventId,
    selectEvent,
    isLoading: isEventsLoading,
    error: eventsError,
  } = useEventSelection();

  const { data, error, isLoading } = useSearchTasks(selectedEventId);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const [editing, setEditing] = useState<RallyTask | null>(null);

  const tasks = data?.items ?? [];
  const loadError = eventsError ?? error;

  useEffect(() => {
    if (loadError) {
      showError(getApiErrorMessage(loadError) ?? "Could not load the task library.");
    }
  }, [loadError, showError]);

  const handleSave = (body: CreateTaskRequest): void => {
    if (!editing || !selectedEventId) return;

    const onError = (saveError: Error): void =>
      showError(getApiErrorMessage(saveError) ?? "Could not save the task.");

    if (editing.id === "") {
      createTask.mutate(
        { eventId: selectedEventId, body },
        {
          onSuccess: () => {
            showSuccess(`Task ${body.code} added.`);
            setEditing(null);
          },
          onError,
        },
      );

      return;
    }

    updateTask.mutate(
      { taskId: editing.id, eventId: selectedEventId, body },
      {
        onSuccess: () => {
          showSuccess(`Task ${body.code} saved.`);
          setEditing(null);
        },
        onError,
      },
    );
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
      <Box sx={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        <Typography variant="h5">
          Task library
          {!isLoading && data && (
            <Typography color="text.secondary" component="span" variant="h5">
              {" "}
              · {data.totalCount}
            </Typography>
          )}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <EventSelect
          events={events}
          isLoading={isEventsLoading}
          onChange={selectEvent}
          selectedEventId={selectedEventId}
        />
        <Button
          disabled={!selectedEventId}
          onClick={() =>
            setEditing(newTask(selectedEventId ?? "", nextFreeCode(tasks)))
          }
          startIcon={<Plus size={16} />}
          type="button"
          variant="contained"
        >
          Task
        </Button>
      </Box>

      <TasksTable
        isLoading={isEventsLoading || isLoading}
        onEdit={setEditing}
        tasks={tasks}
      />

      <Typography color="text.secondary" variant="caption">
        Scoring is server-side: the engine validates every submission against
        these parameters, and answers are stripped before a definition reaches a
        crew's phone.
      </Typography>

      <TaskEditDialog
        isSaving={createTask.isPending || updateTask.isPending}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        task={editing}
      />
    </Box>
  );
}
