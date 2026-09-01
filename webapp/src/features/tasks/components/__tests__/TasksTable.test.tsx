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
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TasksTable from "@features/tasks/components/TasksTable";
import { NULL_PLACEHOLDER } from "@constants/common";
import type { RallyTask } from "@/types/task";

const task = (overrides: Partial<RallyTask>): RallyTask => ({
  id: "t1",
  eventId: "e1",
  code: "T1",
  title: "Translation Cipher",
  type: "INPUT_SELECT",
  trigger: "geofence",
  points: 50,
  sensor: "none",
  config: {},
  ...overrides,
});

const cipher = task({});
const telematics = task({
  id: "t4",
  code: "T4",
  title: "Eco-Driving Telematics",
  type: "TELEMATICS",
  trigger: "sensor",
  sensor: "devicemotion",
  points: 80,
});
const branch = task({
  id: "t11",
  code: "T11",
  title: "Dynamic Route Select",
  type: "BRANCH",
  trigger: "choice",
  points: 40,
});
const rest = task({
  id: "t12",
  code: "T12",
  title: "Mandatory Static Rest",
  type: "REST_LOCK",
  points: 0,
});

const renderTable = (tasks: RallyTask[], onEdit = vi.fn()) => {
  render(<TasksTable tasks={tasks} isLoading={false} onEdit={onEdit} />);

  return onEdit;
};

describe("TasksTable", () => {
  it("renders the A4 columns", () => {
    renderTable([cipher]);

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["#", "Task", "Type", "Trigger", "Pts", ""]);
  });

  it("shows the code, title and category chip", () => {
    renderTable([cipher, telematics]);

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("T1")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Translation Cipher")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Input")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Sensor")).toBeInTheDocument();
  });

  // The wireframe's Trigger column shows the sensor when a task has one —
  // "Accelerometer" is more use to an organizer than "Sensor".
  it("shows the sensor in the trigger column when the task has one", () => {
    renderTable([cipher, telematics]);

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Geofence")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Accelerometer")).toBeInTheDocument();
  });

  // A branch is the one task that can cost points, and a rest lock never
  // awards any — neither reads as a plain number.
  it("renders branch and rest points distinctly", () => {
    renderTable([cipher, branch, rest]);

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("50")).toBeInTheDocument();
    expect(within(rows[2]).getByText("±40")).toBeInTheDocument();
    expect(within(rows[3]).getByText(NULL_PLACEHOLDER)).toBeInTheDocument();
  });

  it("opens the editor for the row that was clicked", async () => {
    const user = userEvent.setup();
    const onEdit = renderTable([cipher, telematics]);

    await user.click(screen.getAllByRole("button", { name: "Edit" })[1]);

    expect(onEdit).toHaveBeenCalledWith(telematics);
  });

  it("tells the organizer when the library is empty", () => {
    renderTable([]);

    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument();
  });
});
