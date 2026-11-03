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

import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppProvider from "@context/AppProvider";
import { SessionSocketContext } from "@context/SessionSocketContext";
import { initialSessionSocket, type SessionSocketState } from "@hooks/useSessionSocket";
import type { SessionState, SessionStatus } from "@/types/session.model";
import CountdownPage from "./CountdownPage";

const getState = vi.fn<() => Promise<SessionState>>();

vi.mock("@config/endpoints", () => ({ WS_URL: "ws://backend.test/ws" }));

vi.mock("@services/session", () => ({
  session: { state: () => ({ queryKey: ["session", "state"], queryFn: () => getState() }) },
}));

const NOW = new Date("2027-02-14T03:29:53Z");
const START = new Date("2027-02-14T03:30:00Z"); // 09:00 in Colombo, 7 s away

const state = (overrides: { status?: SessionStatus; startsAt?: Date | null; cipher?: string | null } = {}) =>
  ({
    session: { id: "s1", status: overrides.status ?? "bound", totalScore: 0 },
    vehicleCode: "PKT-001",
    teamName: "Data Dashers",
    startTime: "09:00",
    startsAt: overrides.startsAt === undefined ? START : overrides.startsAt,
    cipher: overrides.cipher ?? null,
  }) as SessionState;

/** The socket's view, swappable mid-test the way frames arrive. */
let socket: SessionSocketState;
let rerenderWith: (next: Partial<SessionSocketState>) => void;

const Page = ({ value }: { value: SessionSocketState }) => (
  <SessionSocketContext value={value}>
    <MemoryRouter initialEntries={["/countdown"]}>
      <Routes>
        <Route path="/countdown" element={<CountdownPage />} />
        <Route path="/route" element={<p>route</p>} />
        <Route path="/arrival" element={<p>arrival</p>} />
      </Routes>
    </MemoryRouter>
  </SessionSocketContext>
);

const renderPage = () => {
  socket = { ...initialSessionSocket, connected: true };
  const view = render(
    <AppProvider>
      <Page value={socket} />
    </AppProvider>,
  );
  rerenderWith = (next) => {
    socket = { ...socket, ...next };
    view.rerender(
      <AppProvider>
        <Page value={socket} />
      </AppProvider>,
    );
  };
};

const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  getState.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CountdownPage (B3)", () => {
  it("counts down to the start with the cipher still hidden", async () => {
    getState.mockResolvedValue(state());

    renderPage();
    expect(await screen.findByText("00:07")).toBeInTheDocument();
    tick(2_000);

    expect(screen.getByText("00:05")).toBeInTheDocument();
    expect(screen.getByText(/revealed on every car at the start/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /go/i })).toBeNull();
  });

  it("reveals the cipher when the start arrives, and lets the crew go", async () => {
    getState.mockResolvedValue(state());

    renderPage();
    await screen.findByText("00:07");
    tick(7_000);
    rerenderWith({ startSignal: true, startsAt: START, cipher: "47°N // PKT → EDGE" });

    expect(screen.getByText("47°N // PKT → EDGE")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /go/i }));
    expect(screen.getByText("route")).toBeInTheDocument();
  });

  // An event with no cipher configured gets a start and no reveal.
  it("releases on the start signal alone", async () => {
    getState.mockResolvedValue(state());

    renderPage();
    await screen.findByText("00:07");
    rerenderWith({ startSignal: true, startsAt: START });

    expect(screen.getByText(/the rally has started/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go/i })).toBeEnabled();
  });

  // A phone that joined late, or whose socket was down at 09:00, reads the
  // same release from GET /sessions/me.
  it("reveals a cipher the server already holds", async () => {
    vi.setSystemTime(new Date("2027-02-14T03:31:00Z"));
    getState.mockResolvedValue(state({ cipher: "API Integration" }));

    renderPage();

    expect(await screen.findByText("API Integration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go/i })).toBeEnabled();
  });

  // The phone's clock is for show; the server says when the rally starts.
  it("waits for the server at zero rather than starting on its own clock", async () => {
    getState.mockResolvedValue(state());

    renderPage();
    await screen.findByText("00:07");
    tick(8_000);

    expect(screen.getByText(/waiting for the start signal/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /go/i })).toBeNull();
  });

  // A missed frame on an event with no cipher would otherwise hold the car at
  // the line forever.
  it("lets the car go on its own clock once the start is well past", async () => {
    getState.mockResolvedValue(state());

    renderPage();
    await screen.findByText("00:07");
    tick(7_000 + 30_000);

    expect(screen.getByText(/the rally has started/i)).toBeInTheDocument();
  });

  it("says so when the start time cannot be read, and still releases on the signal", async () => {
    getState.mockResolvedValue(state({ startsAt: null }));

    renderPage();
    expect(await screen.findByText(/start time could not be read/i)).toBeInTheDocument();
    rerenderWith({ startSignal: true });

    expect(screen.getByRole("button", { name: /go/i })).toBeEnabled();
  });

  it("sends a car already under way to its route", async () => {
    getState.mockResolvedValue(state({ status: "active", cipher: "API Integration" }));

    renderPage();

    expect(await screen.findByText("route")).toBeInTheDocument();
  });

  it("sends a car that has finished to its arrival screen", async () => {
    getState.mockResolvedValue(state({ status: "finished" }));

    renderPage();

    expect(await screen.findByText("arrival")).toBeInTheDocument();
  });

  it("offers a retry when the run cannot be loaded", async () => {
    getState.mockRejectedValueOnce(new Error("Could not reach the rally server."));
    getState.mockResolvedValueOnce(state());

    renderPage();
    expect(await screen.findByText("Could not reach the rally server.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("00:07")).toBeInTheDocument();
  });
});
