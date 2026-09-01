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

/**
 * The thirteen task types behind the fifteen rally challenges. Three of the
 * challenges (signpost arithmetic, milestone digits, odometer calibration)
 * share INPUT_NUMBER.
 *
 * Mirrors `tasks.TaskType` in the backend; the engine picks a validator by this
 * value and the micro app picks a screen body by it.
 */
export type TaskType =
  | "INPUT_SELECT"
  | "INPUT_NUMBER"
  | "MULTI_SELECT"
  | "SCAN_BARCODE"
  | "TELEMATICS"
  | "GEOFENCE_CROSS"
  | "PROXIMITY"
  | "GRID_FILL"
  | "BLIND_TIMER"
  | "BRANCH"
  | "REST_LOCK"
  | "TIMED_TRIVIA"
  | "GATE_MATCH";

/** What makes a task available to a crew. Mirrors `tasks.Trigger`. */
export type TaskTrigger = "geofence" | "sensor" | "choice" | "manual" | "timed";

/** The device capability a task needs. Mirrors `tasks.Sensor`. */
export type TaskSensor =
  | "none"
  | "geolocation"
  | "devicemotion"
  | "camera"
  | "qr";

/** One authored challenge. Mirrors the backend `TaskDTO`. */
export interface RallyTask {
  id: string;
  eventId: string;
  /** The organizer-facing label, T1 through T15. */
  code: string;
  title: string;
  type: TaskType;
  trigger: TaskTrigger;
  /** The maximum award. Only a BRANCH may be negative. */
  points: number;
  sensor: TaskSensor;
  /** Per-type parameters. Always a JSON object, never null. */
  config: TaskConfig;
}

/**
 * The per-type parameter bag.
 *
 * Deliberately open: the backend passes `config` through untouched and only the
 * task engine and the matching micro-app screen interpret it, so the web app
 * must not drop keys it does not recognise when saving an edit.
 */
export type TaskConfig = Record<string, unknown>;

/** `POST /events/{eventId}/tasks` body. */
export interface CreateTaskRequest {
  code: string;
  title: string;
  type: TaskType;
  trigger: TaskTrigger;
  points: number;
  sensor: TaskSensor;
  config: TaskConfig;
}

/** `PATCH /tasks/{taskId}` body — an omitted field is left unchanged. */
export type UpdateTaskRequest = Partial<CreateTaskRequest>;

/** `POST /events/{eventId}/tasks/search` body. */
export interface SearchTasksRequest {
  offset: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Config field registry
// ---------------------------------------------------------------------------

/** How a config value is edited, and therefore how it is stored in JSON. */
export type ConfigFieldKind = "text" | "number" | "list";

export interface ConfigField {
  key: string;
  label: string;
  kind: ConfigFieldKind;
  helperText?: string;
  /**
   * True for the keys `tasks.RedactForCrew` strips before a definition reaches
   * an in-car phone. Marked in the UI so an organizer can see at a glance which
   * values are the answer and which are the question.
   */
  secret?: boolean;
}

/** Broad grouping shown as a chip in the A4 table. */
export type TaskCategory = "Input" | "Sensor" | "Puzzle" | "Branch" | "Rest";

export interface TaskTypeMeta {
  label: string;
  category: TaskCategory;
  /** The config keys the backend actually reads for this type. */
  fields: ConfigField[];
  /** Shown in the editor when the type scores without reading its config. */
  note?: string;
}

/**
 * A prompt is presentation, not scoring: the micro app renders it and the
 * backend never reads it. Every type gets one, which is why it is shared.
 */
const PROMPT_FIELD: ConfigField = {
  key: "prompt",
  label: "Prompt",
  kind: "text",
  helperText: "Shown to the crew above the task body.",
};

const OPTIONS_FIELD: ConfigField = {
  key: "options",
  label: "Options",
  kind: "list",
  helperText: "One per line. Shown to the crew to choose from.",
};

/**
 * What each task type is called, how it is grouped, and which config keys it
 * uses.
 *
 * Every field below corresponds to a key the Go task engine decodes — see
 * `internal/taskengine/types_input.go` and `types_sensor.go`. Adding a scoring
 * key here without adding it to `secretConfigKeys` in `internal/tasks/redact.go`
 * would ship the answer to the crew's phone.
 */
export const TASK_TYPE_META: Record<TaskType, TaskTypeMeta> = {
  INPUT_SELECT: {
    label: "Single choice",
    category: "Input",
    fields: [
      PROMPT_FIELD,
      OPTIONS_FIELD,
      {
        key: "answer",
        label: "Answer",
        kind: "text",
        secret: true,
        helperText: "Matched case-insensitively, ignoring surrounding spaces.",
      },
    ],
  },
  INPUT_NUMBER: {
    label: "Numeric answer",
    category: "Input",
    fields: [
      PROMPT_FIELD,
      { key: "answer", label: "Answer", kind: "number", secret: true },
      {
        key: "tolerance",
        label: "Tolerance",
        kind: "number",
        secret: true,
        helperText:
          "Allowed absolute difference. Leave empty to require an exact match.",
      },
    ],
  },
  MULTI_SELECT: {
    label: "Multiple choice",
    category: "Input",
    fields: [
      PROMPT_FIELD,
      OPTIONS_FIELD,
      {
        key: "answers",
        label: "Answers",
        kind: "list",
        secret: true,
        helperText:
          "One per line. Scored on set equality — order does not matter, but nothing may be missing or extra.",
      },
    ],
  },
  TIMED_TRIVIA: {
    label: "Timed trivia",
    category: "Input",
    fields: [
      PROMPT_FIELD,
      OPTIONS_FIELD,
      { key: "answer", label: "Answer", kind: "text", secret: true },
      {
        key: "limitSec",
        label: "Time limit (seconds)",
        kind: "number",
        helperText:
          "A correct answer that arrives late earns nothing. Not secret — the crew sees the countdown.",
      },
    ],
  },
  SCAN_BARCODE: {
    label: "Barcode scan",
    category: "Sensor",
    fields: [
      PROMPT_FIELD,
      {
        key: "payload",
        label: "Expected payload",
        kind: "text",
        secret: true,
        helperText:
          "The exact code on the checkpoint. Manual entry is always allowed, so case is forgiven.",
      },
    ],
  },
  TELEMATICS: {
    label: "Eco-driving telematics",
    category: "Sensor",
    fields: [PROMPT_FIELD],
    note:
      "Scored from the driving data the phone reports, not from config: each harsh stop or sharp turn costs 5% of the award. Points below set the ceiling.",
  },
  GEOFENCE_CROSS: {
    label: "Geofence crossing",
    category: "Sensor",
    fields: [PROMPT_FIELD],
    note:
      "Awarded automatically when the backend's own geofence evaluation unlocks it. The radius lives on the waypoint, not here.",
  },
  PROXIMITY: {
    label: "Proximity checkpoint",
    category: "Sensor",
    fields: [
      PROMPT_FIELD,
      {
        key: "checkpointId",
        label: "Checkpoint id",
        kind: "text",
        secret: true,
        helperText: "Identifies the QR or geofence checkpoint that satisfies this task.",
      },
    ],
    note: "Stands in for a BLE beacon: a QR checkpoint, or a geofence on iOS.",
  },
  GRID_FILL: {
    label: "Grid fill",
    category: "Puzzle",
    fields: [
      PROMPT_FIELD,
      {
        key: "solution",
        label: "Solution cells",
        kind: "list",
        secret: true,
        helperText:
          "One cell per line, in order. Scored per correct cell, so a partly right grid still earns part of the points.",
      },
    ],
  },
  GATE_MATCH: {
    label: "Sequence gate match",
    category: "Puzzle",
    fields: [
      PROMPT_FIELD,
      {
        key: "solution",
        label: "Connector sequence",
        kind: "list",
        secret: true,
        helperText:
          "One connector per line, in order. All or nothing — a sequence in the wrong order is simply wrong.",
      },
    ],
  },
  BLIND_TIMER: {
    label: "Blind timer",
    category: "Puzzle",
    fields: [
      PROMPT_FIELD,
      {
        key: "targetSec",
        label: "Target (seconds)",
        kind: "number",
        secret: true,
        helperText:
          "Guessing it exactly earns everything; twice the target earns nothing. Secret — guessing it is the task.",
      },
    ],
  },
  BRANCH: {
    label: "Route branch",
    category: "Branch",
    fields: [
      PROMPT_FIELD,
      { key: "solvePoints", label: "Points for solving", kind: "number", secret: true },
      {
        key: "skipPoints",
        label: "Points for skipping",
        kind: "number",
        secret: true,
        helperText: "Usually negative — skipping the detour costs.",
      },
    ],
    note:
      "The only task that can cost points. These two values are what actually score; the Points field above is not used for a branch.",
  },
  REST_LOCK: {
    label: "Mandatory rest",
    category: "Rest",
    fields: [PROMPT_FIELD],
    note:
      "A compliance stop, not a challenge: completing it awards nothing but marks the task done so the crew can move on.",
  },
};

/** Every task type, in the order the editor's dropdown offers them. */
export const TASK_TYPES = Object.keys(TASK_TYPE_META) as TaskType[];

export const TASK_TRIGGERS: TaskTrigger[] = [
  "geofence",
  "sensor",
  "choice",
  "manual",
  "timed",
];

export const TASK_SENSORS: TaskSensor[] = [
  "none",
  "geolocation",
  "devicemotion",
  "camera",
  "qr",
];

/** Human labels for the trigger and sensor enums. */
export const TRIGGER_LABELS: Record<TaskTrigger, string> = {
  geofence: "Geofence",
  sensor: "Sensor",
  choice: "Choice",
  manual: "Manual",
  timed: "Timed",
};

export const SENSOR_LABELS: Record<TaskSensor, string> = {
  none: "None",
  geolocation: "Geolocation",
  devicemotion: "Accelerometer",
  camera: "Camera",
  qr: "QR checkpoint",
};

/** Chip colour per category, matching the A4 wireframe's accent/amber split. */
export const CATEGORY_COLORS: Record<TaskCategory, "info" | "warning"> = {
  Input: "info",
  Puzzle: "info",
  Branch: "info",
  Sensor: "warning",
  Rest: "warning",
};
