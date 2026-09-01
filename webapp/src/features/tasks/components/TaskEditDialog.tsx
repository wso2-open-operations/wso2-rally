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

import { useState, type FormEvent, type JSX } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  TextField,
} from "@wso2/oxygen-ui";
import TaskConfigEditor from "@features/tasks/components/TaskConfigEditor";
import {
  SENSOR_LABELS,
  TASK_SENSORS,
  TASK_TRIGGERS,
  TASK_TYPES,
  TASK_TYPE_META,
  TRIGGER_LABELS,
  type CreateTaskRequest,
  type RallyTask,
  type TaskConfig,
  type TaskSensor,
  type TaskTrigger,
  type TaskType,
} from "@/types/task";

export interface TaskEditDialogProps {
  /** The task under edit, or null when the dialog is closed. */
  task: RallyTask | null;
  isSaving: boolean;
  onSave: (body: CreateTaskRequest) => void;
  onClose: () => void;
}

interface FormState {
  code: string;
  title: string;
  type: TaskType;
  trigger: TaskTrigger;
  sensor: TaskSensor;
  points: string;
  config: TaskConfig;
}

type FieldErrors = Partial<Record<"code" | "title" | "points", string>>;

const toFormState = (task: RallyTask): FormState => ({
  code: task.code,
  title: task.title,
  type: task.type,
  trigger: task.trigger,
  sensor: task.sensor,
  points: String(task.points),
  config: task.config ?? {},
});

const validate = (form: FormState): FieldErrors => {
  const errors: FieldErrors = {};
  if (!form.code.trim()) {
    errors.code = "Code is required.";
  }
  if (!form.title.trim()) {
    errors.title = "Title is required.";
  }

  const points = Number(form.points);
  if (form.points.trim() === "" || Number.isNaN(points)) {
    errors.points = "Points must be a number.";
  } else if (points < 0 && form.type !== "BRANCH") {
    // The same rule the backend enforces: only a branch is a scored decision
    // rather than a failure, so only a branch may cost points.
    errors.points = "Only a branch task may have negative points.";
  }

  return errors;
};

/**
 * Authors or retunes one task (A4).
 *
 * The body below the divider is chosen by the task's type, which is what makes
 * the engine config-driven: changing a challenge is authoring, not a
 * deployment.
 *
 * @param {TaskEditDialogProps} props - The task under edit and its handlers.
 * @returns {JSX.Element | null} The dialog, or null when closed.
 */
export default function TaskEditDialog({
  task,
  isSaving,
  onSave,
  onClose,
}: TaskEditDialogProps): JSX.Element | null {
  if (!task) {
    return null;
  }

  return (
    <TaskEditDialogForm
      // Remounts when a different task is opened, so the form always starts
      // from that task rather than from whatever was edited last.
      key={task.id}
      isSaving={isSaving}
      onClose={onClose}
      onSave={onSave}
      task={task}
    />
  );
}

function TaskEditDialogForm({
  task,
  isSaving,
  onSave,
  onClose,
}: TaskEditDialogProps & { task: RallyTask }): JSX.Element {
  const [form, setForm] = useState<FormState>(() => toFormState(task));
  const [errors, setErrors] = useState<FieldErrors>({});

  const isNew = task.id === "";

  const setField = <K extends keyof FormState>(field: K, value: FormState[K]): void => {
    setForm((previous) => ({ ...previous, [field]: value }));
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }

    onSave({
      code: form.code.trim(),
      title: form.title.trim(),
      type: form.type,
      trigger: form.trigger,
      sensor: form.sensor,
      points: Number(form.points),
      config: form.config,
    });
  };

  return (
    <Dialog fullWidth maxWidth="sm" onClose={onClose} open>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogTitle>{isNew ? "New task" : `Edit ${task.code}`}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField
                error={Boolean(errors.code)}
                helperText={errors.code ?? "T1 through T15."}
                label="Code"
                onChange={(e) => setField("code", e.target.value)}
                size="small"
                sx={{ width: 140 }}
                value={form.code}
              />
              <TextField
                error={Boolean(errors.title)}
                fullWidth
                helperText={errors.title}
                label="Title"
                onChange={(e) => setField("title", e.target.value)}
                size="small"
                value={form.title}
              />
            </Box>

            <TextField
              helperText="Selects the validator that scores this task."
              label="Type"
              onChange={(e) => setField("type", e.target.value as TaskType)}
              select
              size="small"
              value={form.type}
            >
              {TASK_TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {TASK_TYPE_META[type].label} · {type}
                </MenuItem>
              ))}
            </TextField>

            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField
                fullWidth
                helperText="What makes the task available."
                label="Trigger"
                onChange={(e) => setField("trigger", e.target.value as TaskTrigger)}
                select
                size="small"
                value={form.trigger}
              >
                {TASK_TRIGGERS.map((trigger) => (
                  <MenuItem key={trigger} value={trigger}>
                    {TRIGGER_LABELS[trigger]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                fullWidth
                helperText="Permission the phone must request."
                label="Sensor"
                onChange={(e) => setField("sensor", e.target.value as TaskSensor)}
                select
                size="small"
                value={form.sensor}
              >
                {TASK_SENSORS.map((sensor) => (
                  <MenuItem key={sensor} value={sensor}>
                    {SENSOR_LABELS[sensor]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                error={Boolean(errors.points)}
                helperText={errors.points}
                label="Points"
                onChange={(e) => setField("points", e.target.value)}
                size="small"
                sx={{ width: 130 }}
                type="number"
                value={form.points}
              />
            </Box>

            <Divider />

            <TaskConfigEditor
              config={form.config}
              onChange={(config) => setField("config", config)}
              type={form.type}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} type="button" variant="text">
            Cancel
          </Button>
          <Button
            disabled={isSaving}
            startIcon={isSaving ? <CircularProgress color="inherit" size={16} /> : undefined}
            type="submit"
            variant="contained"
          >
            Save
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
