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

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppProvider from "@context/AppProvider";
import type { SessionState, TaskStatus, TaskSummary } from "@/types/session.model";
import SessionAppBar from "./SessionAppBar";

const getState = vi.fn<() => Promise<SessionState>>();
const getTasks = vi.fn<() => Promise<TaskSummary[]>>();
vi.mock("@services/session", () => ({
  session: {
    state: () => ({ queryKey: ["session", "state"], queryFn: () => getState() }),
    tasks: () => ({ queryKey: ["session", "tasks"], queryFn: () => getTasks() }),
  },
}));

const tasks = (...statuses: TaskStatus[]) => statuses.map((status, i) => ({ id: `t${i}`, status }) as TaskSummary);

const renderBar = () =>
  render(
    <AppProvider>
      <MemoryRouter initialEntries={["/route"]}>
        <Routes>
          <Route path="/route" element={<SessionAppBar />} />
          <Route path="/report" element={<p>report</p>} />
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );

beforeEach(() => {
  getState.mockReset();
  getTasks.mockReset();
  getState.mockResolvedValue({
    session: { totalScore: 640 },
    vehicleCode: "PKT-001",
    teamName: "Data Dashers",
  } as SessionState);
});

describe("SessionAppBar", () => {
  // A skipped task is settled too: the BRANCH shortcut skips it on purpose.
  it("shows the run's score and how many of its tasks are settled", async () => {
    getTasks.mockResolvedValue([
      ...tasks("completed", "completed", "completed", "completed", "skipped"),
      ...tasks(...Array<TaskStatus>(10).fill("pending")),
    ]);

    renderBar();

    expect(await screen.findByText("5/15")).toBeInTheDocument();
    expect(screen.getByText("640")).toBeInTheDocument();
    expect(screen.getByText("PKT-001")).toBeInTheDocument();
  });

  it("shows no numbers it does not have", async () => {
    getTasks.mockRejectedValue(new Error("Could not reach the rally server."));

    renderBar();

    expect(await screen.findByText("PKT-001")).toBeInTheDocument();
    expect(screen.queryByText("640")).toBeNull();
  });

  it("reaches the vehicle issue report from every screen", async () => {
    getTasks.mockResolvedValue([]);
    renderBar();

    fireEvent.click(await screen.findByRole("button", { name: /report vehicle issue/i }));

    expect(screen.getByText("report")).toBeInTheDocument();
  });
});
