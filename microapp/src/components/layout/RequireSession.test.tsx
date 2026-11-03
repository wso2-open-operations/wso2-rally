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

import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@store/session";
import RequireSession from "./RequireSession";

const restoreSession = vi.fn<() => Promise<void>>();
vi.mock("@services/session", () => ({ restoreSession: () => restoreSession() }));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>join screen</p>} />
        <Route element={<RequireSession />}>
          <Route path="/lock" element={<p>start grid</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  useSessionStore.getState().clear();
  restoreSession.mockReset();
});

describe("RequireSession", () => {
  it("shows the screen to a phone that has joined", () => {
    useSessionStore.getState().setToken("team-tok");

    renderAt("/lock");

    expect(screen.getByText("start grid")).toBeInTheDocument();
    expect(restoreSession).not.toHaveBeenCalled();
  });

  // After a reload the store is empty but the token is in storage. Redirecting
  // before looking would throw a joined crew back to the join screen.
  it("restores a stored session before deciding", async () => {
    // Held open, the way a secure-store read over the bridge is.
    let finish!: () => void;
    restoreSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            useSessionStore.getState().setToken("restored");
            resolve();
          };
        }),
    );

    renderAt("/lock");

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByText("join screen")).toBeNull();
    act(() => finish());
    expect(await screen.findByText("start grid")).toBeInTheDocument();
  });

  it("sends a phone with no session to join", async () => {
    restoreSession.mockResolvedValue();

    renderAt("/lock");

    expect(await screen.findByText("join screen")).toBeInTheDocument();
  });
});
