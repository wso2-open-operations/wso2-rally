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
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppProvider from "@context/AppProvider";
import type { Position, PositionFailure } from "@sensors/position";
import type { Circle, SessionState, SessionStatus } from "@/types/session.model";
import GeofenceLockPage from "./GeofenceLockPage";

const getState = vi.fn<() => Promise<SessionState>>();

vi.mock("@services/session", () => ({
  session: { state: () => ({ queryKey: ["session", "state"], queryFn: () => getState() }) },
}));

/** The position stream, driven by hand. */
const watches: { onPosition: (p: Position) => void; onError?: (r: PositionFailure) => void }[] = [];

vi.mock("@sensors/position", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sensors/position")>()),
  watchPosition: (onPosition: (p: Position) => void, onError?: (r: PositionFailure) => void) => {
    watches.push({ onPosition, onError });
    return () => {};
  },
}));

const fix = (position: Position) => act(() => watches[watches.length - 1].onPosition(position));
const fail = (reason: PositionFailure) => act(() => watches[watches.length - 1].onError?.(reason));

// A 40 m start grid, a fix ~15 m from its centre, and one ~100 m away.
const GRID: Circle = { lat: 6.8901, lng: 79.92, radiusM: 40, placed: true };
const INSIDE: Position = { lat: 6.8902, lng: 79.9201, accuracy: 8 };
const OUTSIDE: Position = { lat: 6.891, lng: 79.92, accuracy: 8 };

const state = (status: SessionStatus = "bound", startCircle: Circle = GRID): SessionState =>
  ({
    session: { id: "s1", eventId: "e1", vehicleId: "veh1", status, currentWaypointId: null, totalScore: 0 },
    vehicleCode: "PKT-001",
    teamName: "Data Dashers",
    startCircle,
  }) as SessionState;

const renderPage = () =>
  render(
    <AppProvider>
      <MemoryRouter initialEntries={["/lock"]}>
        <Routes>
          <Route path="/lock" element={<GeofenceLockPage />} />
          <Route path="/countdown" element={<p>countdown</p>} />
          <Route path="/arrival" element={<p>arrival</p>} />
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );

beforeEach(() => {
  watches.length = 0;
  getState.mockReset();
});

describe("GeofenceLockPage (B2)", () => {
  it("stays locked and says how far the grid is while the car is outside", async () => {
    getState.mockResolvedValue(state());

    renderPage();
    expect(await screen.findByText(/move into the start grid/i)).toBeInTheDocument();
    fix(OUTSIDE);

    // ~100 m from the centre of a 40 m grid: ~60 m to go.
    expect(screen.getByText(/locked · 6\d m away/i)).toBeInTheDocument();
    expect(screen.getByText(/accuracy ±8 m/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /locked until inside the grid/i })).toBeDisabled();
    expect(screen.queryByText("countdown")).toBeNull();
  });

  it("moves on to the countdown once the car is inside the grid", async () => {
    getState.mockResolvedValue(state());

    renderPage();
    await screen.findByText(/move into the start grid/i);
    fix(OUTSIDE);
    fix(INSIDE);

    expect(await screen.findByText("countdown")).toBeInTheDocument();
  });

  it("waits for a first fix without claiming a distance", async () => {
    getState.mockResolvedValue(state());

    renderPage();

    expect(await screen.findByText(/finding your position/i)).toBeInTheDocument();
    expect(screen.queryByText(/m away/i)).toBeNull();
  });

  // A phone that reports nothing must say why, in words the crew can act on —
  // and offer to ask again once they have.
  it("explains a location failure and asks again on request", async () => {
    getState.mockResolvedValue(state());

    renderPage();
    await screen.findByText(/move into the start grid/i);
    fail("permission_denied");

    expect(screen.getByText(/has not allowed the rally app to use location/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(watches).toHaveLength(2);
    fix(INSIDE);
    expect(await screen.findByText("countdown")).toBeInTheDocument();
  });

  // Rejoining mid-rally lands on this screen too. A car already past the grid
  // must not be sent back to it.
  it("lets a car that has already started straight through", async () => {
    getState.mockResolvedValue(state("active"));

    renderPage();

    expect(await screen.findByText("countdown")).toBeInTheDocument();
  });

  it("sends a car that has finished to its arrival screen", async () => {
    getState.mockResolvedValue(state("finished"));

    renderPage();

    expect(await screen.findByText("arrival")).toBeInTheDocument();
  });

  // Publishing requires the pin, so this is an organizer's slip, not a crew's.
  // A grid that is not there cannot be entered: the lock holds and says why.
  it("holds the lock when the start grid has not been placed", async () => {
    getState.mockResolvedValue(state("bound", { lat: 0, lng: 0, radiusM: 40, placed: false }));

    renderPage();
    expect(await screen.findByText(/start grid has not been placed/i)).toBeInTheDocument();
    fix({ lat: 0, lng: 0, accuracy: 5 });

    expect(screen.queryByText("countdown")).toBeNull();
  });

  it("offers a retry when the run cannot be loaded", async () => {
    getState.mockRejectedValueOnce(new Error("Could not reach the rally server."));
    getState.mockResolvedValueOnce(state());

    renderPage();
    expect(await screen.findByText("Could not reach the rally server.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText(/move into the start grid/i)).toBeInTheDocument();
  });
});
