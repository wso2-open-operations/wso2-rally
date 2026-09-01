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

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TaskEditDialog from "@features/tasks/components/TaskEditDialog";
import type { RallyTask } from "@/types/task";

const cipher: RallyTask = {
  id: "t1",
  eventId: "e1",
  code: "T1",
  title: "Translation Cipher",
  type: "INPUT_SELECT",
  trigger: "geofence",
  points: 50,
  sensor: "none",
  config: {
    prompt: "Translate the sign",
    options: ["API Integration", "Data Mesh"],
    answer: "API Integration",
  },
};

const renderDialog = (task: RallyTask | null, isSaving = false) => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <TaskEditDialog
      isSaving={isSaving}
      onClose={onClose}
      onSave={onSave}
      task={task}
    />,
  );

  return { onSave, onClose };
};

describe("TaskEditDialog", () => {
  it("prefills the task fields", () => {
    renderDialog(cipher);

    expect(screen.getByLabelText("Code")).toHaveValue("T1");
    expect(screen.getByLabelText("Title")).toHaveValue("Translation Cipher");
    expect(screen.getByLabelText("Points")).toHaveValue(50);
  });

  // The whole point of the type registry: an INPUT_SELECT edits its answer and
  // options, and nothing else.
  it("renders the config editor for the task's type", () => {
    renderDialog(cipher);

    expect(screen.getByLabelText("Answer")).toHaveValue("API Integration");
    expect(screen.getByLabelText("Prompt")).toHaveValue("Translate the sign");
    expect(screen.getByLabelText("Options")).toHaveValue(
      "API Integration\nData Mesh",
    );
    expect(screen.queryByLabelText("Target (seconds)")).not.toBeInTheDocument();
  });

  it("renders a different config editor for a different type", () => {
    renderDialog({
      ...cipher,
      type: "BLIND_TIMER",
      config: { targetSec: 45 },
    });

    expect(screen.getByLabelText("Target (seconds)")).toHaveValue(45);
    expect(screen.queryByLabelText("Answer")).not.toBeInTheDocument();
  });

  // Keys the backend strips before a definition reaches a phone are marked, so
  // an organizer can see which values are the answer.
  it("marks the secret config keys", () => {
    renderDialog(cipher);

    expect(screen.getByText(/hidden from crews/i)).toBeInTheDocument();
  });

  it("explains a type that scores without reading its config", () => {
    renderDialog({ ...cipher, type: "TELEMATICS", config: {} });

    expect(screen.getByText(/each harsh stop or sharp turn/i)).toBeInTheDocument();
  });

  it("saves the edited task and its config", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog(cipher);

    await user.clear(screen.getByLabelText("Answer"));
    await user.type(screen.getByLabelText("Answer"), "Data Mesh");
    await user.clear(screen.getByLabelText("Points"));
    await user.type(screen.getByLabelText("Points"), "60");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "T1",
        title: "Translation Cipher",
        type: "INPUT_SELECT",
        points: 60,
        config: expect.objectContaining({
          answer: "Data Mesh",
          prompt: "Translate the sign",
          options: ["API Integration", "Data Mesh"],
        }),
      }),
    );
  });

  // The backend passes config through untouched and only the engine and the
  // micro app read it, so an edit must not drop a key this app does not know.
  it("preserves config keys the editor does not render", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog({
      ...cipher,
      config: { ...cipher.config, futureKey: { nested: true } },
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ futureKey: { nested: true } }),
      }),
    );
  });

  it("blocks a save with no code or title", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog({ ...cipher, code: "", title: "" });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/code is required/i)).toBeInTheDocument();
    expect(screen.getByText(/title is required/i)).toBeInTheDocument();
  });

  // Only a branch may cost points, which is what the backend enforces.
  it("rejects negative points on a non-branch task", async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog(cipher);

    await user.clear(screen.getByLabelText("Points"));
    await user.type(screen.getByLabelText("Points"), "-10");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/only a branch task/i)).toBeInTheDocument();
  });

  it("renders nothing when no task is open", () => {
    renderDialog(null);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
