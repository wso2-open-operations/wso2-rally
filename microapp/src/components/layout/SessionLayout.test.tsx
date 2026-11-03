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
import { useSessionEvents } from "@context/SessionSocketContext";
import type { SessionSocketOptions } from "@hooks/useSessionSocket";
import { useSessionStore } from "@store/session";
import type { SessionModel, SessionState } from "@/types/session.model";
import SessionLayout from "./SessionLayout";

const getState = vi.fn<() => Promise<SessionState>>();
const socketCalls: { sessionId: string | null; options?: SessionSocketOptions }[] = [];

vi.mock("@services/session", () => ({
  session: { state: () => ({ queryKey: ["session", "state"], queryFn: () => getState() }) },
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

vi.mock("@config/endpoints", () => ({ WS_URL: "ws://backend.test/ws" }));

function Screen() {
  const socket = useSessionEvents();
  const run = useQuery({ queryKey: ["session", "state"], queryFn: () => getState() });
  return <p>{`cipher: ${socket.cipher ?? "none"} · ${run.data?.vehicleCode ?? "loading"}`}</p>;
}

const renderLayout = () =>
  render(
    <AppProvider>
      <MemoryRouter initialEntries={["/countdown"]}>
        <Routes>
          <Route element={<SessionLayout />}>
            <Route path="/countdown" element={<Screen />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );

beforeEach(() => {
  socketCalls.length = 0;
  getState.mockReset();
  getState.mockResolvedValue({ vehicleCode: "PKT-001" } as SessionState);
  useSessionStore.getState().setJoined("team-tok", { id: "s1" } as SessionModel);
});

describe("SessionLayout", () => {
  it("opens the session socket for this phone's run and shares it with the screen", async () => {
    renderLayout();

    expect(await screen.findByText("cipher: API Integration · PKT-001")).toBeInTheDocument();
    expect(socketCalls.every((call) => call.sessionId === "s1")).toBe(true);
  });

  // The hub sends no history: whatever was broadcast during the drop is gone,
  // so the screen re-reads the run from the server.
  it("refetches the run when the socket reconnects", async () => {
    renderLayout();
    await screen.findByText(/PKT-001/);
    expect(getState).toHaveBeenCalledTimes(1);

    act(() => socketCalls[socketCalls.length - 1].options?.onReconnect?.());

    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
  });

  it("waits for the run's id before opening the socket", () => {
    useSessionStore.getState().clear();
    useSessionStore.getState().setToken("team-tok");

    renderLayout();

    expect(socketCalls[0].sessionId).toBeNull();
  });
});
