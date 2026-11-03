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

import { useQuery } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppProvider from "@context/AppProvider";
import { useReporter } from "@context/LocationReporterContext";
import { useSessionEvents } from "@context/SessionSocketContext";
import type { LocationReporterOptions } from "@hooks/useLocationReporter";
import type { SessionSocketOptions } from "@hooks/useSessionSocket";
import { useSessionStore } from "@store/session";
import type { PingResult, SessionModel, SessionState, SessionStatus, TaskSummary } from "@/types/session.model";
import type { SessionFrame } from "@/types/socket.dto";
import SessionLayout from "./SessionLayout";

const getState = vi.fn<() => Promise<SessionState>>();
const getTasks = vi.fn<() => Promise<TaskSummary[]>>();
const socketCalls: { sessionId: string | null; options?: SessionSocketOptions }[] = [];
const reporterCalls: LocationReporterOptions[] = [];

vi.mock("@services/session", () => ({
  session: {
    state: () => ({ queryKey: ["session", "state"], queryFn: () => getState() }),
    tasks: () => ({ queryKey: ["session", "tasks"], queryFn: () => getTasks() }),
  },
  sessionKeys: { all: ["session"] },
}));

vi.mock("@hooks/useSessionSocket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hooks/useSessionSocket")>();
  return {
    ...actual,
    useSessionSocket: (sessionId: string | null, options?: SessionSocketOptions) => {
      socketCalls.push({ sessionId, options });
      return { ...actual.initialSessionSocket, connected: true, cipher: "API Integration" };
    },
  };
});

vi.mock("@hooks/useLocationReporter", () => ({
  useLocationReporter: (options: LocationReporterOptions) => {
    reporterCalls.push(options);
    return { sharing: false, position: null, failure: null, pingError: null, start: () => {} };
  },
}));

vi.mock("@config/endpoints", () => ({ WS_URL: "ws://backend.test/ws" }));

function Screen() {
  const socket = useSessionEvents();
  const reporter = useReporter();
  const run = useQuery({ queryKey: ["session", "state"], queryFn: () => getState() });
  return (
    <p>{`cipher: ${socket.cipher ?? "none"} · ${run.data?.teamName ?? "loading"} · sharing ${reporter.sharing}`}</p>
  );
}

const renderLayout = (path = "/countdown") =>
  render(
    <AppProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<SessionLayout />}>
            <Route path="/countdown" element={<Screen />} />
            <Route path="/route" element={<Screen />} />
            <Route path="/task/:taskId" element={<p>task screen</p>} />
            <Route path="/rest" element={<p>rest screen</p>} />
            <Route path="/arrival" element={<p>arrival screen</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );

const state = (status: SessionStatus = "bound") =>
  ({ session: { id: "s1", status, totalScore: 0 }, vehicleCode: "PKT-001", teamName: "Data Dashers" }) as SessionState;

const lastSocket = () => socketCalls[socketCalls.length - 1].options!;
const lastReporter = () => reporterCalls[reporterCalls.length - 1];
const frame = (data: SessionFrame) => act(() => lastSocket().onFrame?.(data));
const pinged = (result: Partial<PingResult>) =>
  act(() =>
    lastReporter().onResult?.({ unlockedTaskIds: [], currentWaypointId: null, arrived: false, events: [], ...result }),
  );

beforeEach(() => {
  socketCalls.length = 0;
  reporterCalls.length = 0;
  getState.mockReset();
  getTasks.mockReset();
  getState.mockResolvedValue(state());
  getTasks.mockResolvedValue([]);
  useSessionStore.getState().setJoined("team-tok", { id: "s1" } as SessionModel);
});

describe("SessionLayout", () => {
  it("shares the session socket and the reporter with the screen, under the app bar", async () => {
    renderLayout();

    expect(await screen.findByText("cipher: API Integration · Data Dashers · sharing false")).toBeInTheDocument();
    expect(screen.getByText("PKT-001")).toBeInTheDocument();
    expect(socketCalls.every((call) => call.sessionId === "s1")).toBe(true);
  });

  // The hub sends no history: whatever was broadcast during the drop is gone,
  // so the screen re-reads the run from the server.
  it("refetches the run when the socket reconnects", async () => {
    renderLayout();
    await screen.findByText(/sharing false/);
    const before = getState.mock.calls.length;

    act(() => lastSocket().onReconnect?.());

    await waitFor(() => expect(getState.mock.calls.length).toBeGreaterThan(before));
  });

  it("waits for the run's id before opening the socket", () => {
    useSessionStore.getState().clear();
    useSessionStore.getState().setToken("team-tok");

    renderLayout();

    expect(socketCalls[0].sessionId).toBeNull();
  });

  // A phone reopened mid-rally must not wait for someone to visit B4.
  it("reports by itself once the car is under way, and not before", async () => {
    getState.mockResolvedValue(state("active"));
    renderLayout("/route");
    expect(reporterCalls[0].autoStart).toBe(false);

    await waitFor(() => expect(lastReporter().autoStart).toBe(true));
    expect(lastReporter().runOver).toBe(false);
  });

  it("stops reporting once the run is over", async () => {
    getState.mockResolvedValue(state("finished"));
    renderLayout("/route");

    await waitFor(() => expect(lastReporter().runOver).toBe(true));
  });

  it("opens a task a teammate's phone unlocked while the crew is on the route", async () => {
    renderLayout("/route");
    await screen.findByText(/sharing false/);

    frame({ type: "task_unlocked", taskIds: ["t6"], currentWaypointId: "w3" });

    expect(await screen.findByText("task screen")).toBeInTheDocument();
  });

  it("goes to the arrival screen when this phone's own ping crosses the finish", async () => {
    renderLayout("/route");
    await screen.findByText(/sharing false/);

    pinged({ arrived: true, events: [{ type: "arrival", waypointId: null, taskId: null }] });

    expect(await screen.findByText("arrival screen")).toBeInTheDocument();
  });

  it("holds the car for a rest stop from any screen", async () => {
    renderLayout("/countdown");
    await screen.findByText(/sharing false/);

    frame({ type: "rest_lock", taskId: "t12" });

    expect(await screen.findByText("rest screen")).toBeInTheDocument();
  });

  // A teammate scored, or a checkpoint opened tasks: the score, DONE and the
  // route's task list are all stale.
  it("refreshes the run and its tasks when a teammate settles a task", async () => {
    renderLayout("/route");
    await screen.findByText(/sharing false/);
    const states = getState.mock.calls.length;
    const lists = getTasks.mock.calls.length;

    frame({ type: "task_completed", taskId: "t6", taskCode: "T6", totalScore: 690 });

    await waitFor(() => expect(getState.mock.calls.length).toBeGreaterThan(states));
    await waitFor(() => expect(getTasks.mock.calls.length).toBeGreaterThan(lists));
  });

  it("does not refetch on a ping that changed nothing", async () => {
    renderLayout("/route");
    await screen.findByText(/sharing false/);
    const states = getState.mock.calls.length;

    pinged({});
    await act(async () => {});

    expect(getState.mock.calls.length).toBe(states);
  });
});
