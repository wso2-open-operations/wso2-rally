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

import { Alert, Box, TextField, Typography } from "@wso2/oxygen-ui";
import type { JSX } from "react";
import {
  TASK_TYPE_META,
  type ConfigField,
  type TaskConfig,
  type TaskType,
} from "@/types/task";

export interface TaskConfigEditorProps {
  type: TaskType;
  config: TaskConfig;
  onChange: (config: TaskConfig) => void;
  disabled?: boolean;
}

/** A list config value is stored as a JSON array and edited one item per line. */
const toLines = (value: unknown): string =>
  Array.isArray(value) ? value.map(String).join("\n") : "";

const fromLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const toNumberInput = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

const toTextInput = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

/**
 * Edits the per-type parameters of a task.
 *
 * The task engine is config-driven — adding or retuning a challenge is data,
 * not code — so this is one declarative editor over the field registry in
 * `types/task.ts` rather than thirteen bespoke forms. A new task type becomes a
 * new entry in that registry.
 *
 * @param {TaskConfigEditorProps} props - The type, its config, and a change handler.
 * @returns {JSX.Element} The config editor.
 */
export default function TaskConfigEditor({
  type,
  config,
  onChange,
  disabled = false,
}: TaskConfigEditorProps): JSX.Element {
  const meta = TASK_TYPE_META[type];

  if (!meta) {
    return (
      <Alert severity="warning">
        This web app does not know the task type <strong>{type}</strong> yet, so
        its parameters cannot be edited here without risking data loss.
      </Alert>
    );
  }

  // Spread rather than replace: the backend passes config through untouched and
  // only the engine and the micro app read it, so a key this editor does not
  // render must survive the edit.
  const setValue = (key: string, value: unknown): void => {
    const next = { ...config };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  };

  const renderField = (field: ConfigField): JSX.Element => {
    const secretNote = field.secret ? "Hidden from crews. " : "";
    const helperText = `${secretNote}${field.helperText ?? ""}`.trim() || undefined;

    if (field.kind === "list") {
      return (
        <TextField
          disabled={disabled}
          fullWidth
          helperText={helperText}
          key={field.key}
          label={field.label}
          minRows={3}
          multiline
          onChange={(e) => setValue(field.key, fromLines(e.target.value))}
          size="small"
          value={toLines(config[field.key])}
        />
      );
    }

    if (field.kind === "number") {
      return (
        <TextField
          disabled={disabled}
          fullWidth
          helperText={helperText}
          key={field.key}
          label={field.label}
          onChange={(e) => {
            const raw = e.target.value;
            // An empty box means "not configured", which for an optional key
            // like tolerance is meaningfully different from zero.
            setValue(field.key, raw === "" ? undefined : Number(raw));
          }}
          size="small"
          type="number"
          value={toNumberInput(config[field.key])}
        />
      );
    }

    return (
      <TextField
        disabled={disabled}
        fullWidth
        helperText={helperText}
        key={field.key}
        label={field.label}
        onChange={(e) => setValue(field.key, e.target.value)}
        size="small"
        value={toTextInput(config[field.key])}
      />
    );
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography color="text.secondary" variant="overline">
        {meta.label} parameters
      </Typography>
      {meta.note && <Alert severity="info">{meta.note}</Alert>}
      {meta.fields.map(renderField)}
    </Box>
  );
}
