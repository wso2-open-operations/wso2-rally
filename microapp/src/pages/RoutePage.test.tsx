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
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppProvider from "@context/AppProvider";
import { LocationReporterContext } from "@context/LocationReporterContext";
import { useLocationReporter } from "@hooks/useLocationReporter";
import type { Position, PositionFailure } from "@sensors/position";
import type { Fix, PingResult, SessionState, SessionStatus, TaskSummary } from "@/types/session.model";
import RoutePage from "./RoutePage";

const getState = vi.fn<() => Promise<SessionState>>();
const getTasks = vi.fn<() => Promise<TaskSummary[]>>();
const ping = vi.fn<(fix: Fix) => Promise<PingResult>>();
vi.mock("@services/session", () => ({
  session: {
    state: () => ({ queryKey: ["session", "state"], queryFn: () => getState() }),
    tasks: () => ({ queryKey: ["session", "tasks"], queryFn: () => getTasks() }),
  },
  ping: (fix: Fix) => ping(fix),
}));

const openUrl = vi.fn<(config: { url: string }) => Promise<void>>();
vi.mock("@utils/bridge", () => ({
  isEmbedded: () => true,
  openUrl: (config: { url: string }) => openUrl(config),
}));

const watches: { onPosition: (p: Position) => void; onError?: (r: PositionFailure) => void }[] = [];
vi.mock("@sensors/position", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sensors/position")>()),
  watchPosition: (onPosition: (p: Position) => void, onError?: (r: PositionFailure) => void) => {
    watches.push({ onPosition, onError });
    return () => {};
  },
}));

// The shared stub drops TileLayer's handlers; this one keeps them, so a test
// can fail the imagery the way a dead link does.
const tiles = vi.hoisted(() => ({ handlers: {} as Record<string, () => void> }));
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: ({ eventHandlers }: { eventHandlers?: Record<string, () => void> }) => {
    tiles.handlers = eventHandlers ?? {};
    return null;
  },
  Circle: () => null,
  CircleMarker: () => null,
  Polyline: () => null,
  Tooltip: () => null,
  useMap: () => ({ setView: vi.fn(), getZoom: vi.fn(() => 14) }),
}));

const fix = (position: Position) => act(() => watches[watches.length - 1].onPosition(position));
const fail = (reason: PositionFailure) => act(() => watches[watches.length - 1].onError?.(reason));
const tile = (event: "tileerror" | "tileload") => act(() => tiles.handlers[event]?.());

// The car near the start; checkpoint 1 about 4.7 km south with a 100 m fence.
const HERE: Position = { lat: 6.8901, lng: 79.92, accuracy: 8 };
const circle = (lat: number, lng: number, radiusM = 100) => ({ lat, lng, radiusM, placed: true });

const state = (overrides: Partial<SessionState> & { status?: SessionStatus; currentWaypointId?: string } = {}) =>
  ({
    session: { id: "s1", status: overrides.status ?? "active", currentWaypointId: overrides.currentWaypointId ?? null },
    vehicleCode: "PKT-001",
    teamName: "Data Dashers",
    startCircle: circle(6.8901, 79.92, 40),
    finishCircle: circle(6.79, 79.95),
    waypoints: [
      { id: "w1", order: 1, circle: circle(6.848, 79.928), taskIds: ["t1", "t2"] },
      { id: "w2", order: 2, circle: circle(6.82, 79.94), taskIds: ["t3"] },
    ],
    nextWaypointId: "w1",
    sharingCount: 2,
    you: { sharing: true },
    coverageLost: false,
    ...overrides,
  }) as SessionState;

const task = (id: string, waypointId: string, title: string, status: TaskSummary["status"] = "pending") =>
  ({ id, waypointId, title, code: id.toUpperCase(), type: "BARCODE_SCAN", points: 50, status }) as TaskSummary;

function WithReporter({ children }: { children: ReactNode }) {
  const reporter = useLocationReporter();
  return <LocationReporterContext value={reporter}>{children}</LocationReporterContext>;
}

const renderPage = () =>
  render(
    <AppProvider>
      <WithReporter>
        <MemoryRouter initialEntries={["/route"]}>
          <Routes>
            <Route path="/route" element={<RoutePage />} />
            <Route path="/task/:taskId" element={<p>task screen</p>} />
            <Route path="/report" element={<p>report screen</p>} />
            <Route path="/arrival" element={<p>arrival screen</p>} />
          </Routes>
        </MemoryRouter>
      </WithReporter>
    </AppProvider>,
  );

const DISTANCE = /^4\.\d km$/;

beforeEach(() => {
  watches.length = 0;
  tiles.handlers = {};
  getState.mockReset();
  getTasks.mockReset();
  ping.mockReset();
  openUrl.mockReset();
  getState.mockResolvedValue(state());
  getTasks.mockResolvedValue([task("t1", "w1", "Barcode scan · local item"), task("t3", "w2", "Precision stop")]);
  ping.mockResolvedValue({ unlockedTaskIds: [], currentWaypointId: null, arrived: false, events: [] });
  openUrl.mockResolvedValue();
});

describe("RoutePage (B4)", () => {
  it("shows how far the next checkpoint is, and what is waiting there", async () => {
    renderPage();
    expect(await screen.findByText(/checkpoint 1/i)).toBeInTheDocument();
    fix(HERE);

    expect(screen.getByText(DISTANCE)).toBeInTheDocument();
    expect(screen.getByText(/barcode scan · local item/i)).toBeInTheDocument();
  });

  // B4 is where the car leaves the grid; reporting starts here.
  it("starts reporting the car's position from this phone", async () => {
    renderPage();
    await screen.findByText(/checkpoint 1/i);

    fix(HERE);

    expect(ping).toHaveBeenCalledWith(expect.objectContaining({ lat: HERE.lat, lng: HERE.lng }));
  });

  it("keeps the distance and the pings going when the map imagery fails", async () => {
    renderPage();
    await screen.findByText(/checkpoint 1/i);

    tile("tileerror");
    expect(screen.queryByText(/map imagery unavailable/i)).toBeNull();
    tile("tileerror");
    fix(HERE);

    expect(screen.getByText(/map imagery unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(DISTANCE)).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(ping).toHaveBeenCalled();
  });

  it("drops the notice when the imagery comes back", async () => {
    renderPage();
    await screen.findByText(/checkpoint 1/i);
    tile("tileerror");
    tile("tileerror");

    tile("tileload");

    expect(screen.queryByText(/map imagery unavailable/i)).toBeNull();
  });

  it("lists the tasks still open where the car is", async () => {
    getState.mockResolvedValue(state({ currentWaypointId: "w1", nextWaypointId: "w2" }));
    getTasks.mockResolvedValue([
      task("t1", "w1", "Barcode scan · local item"),
      task("t2", "w1", "Already done", "completed"),
      task("t3", "w2", "Precision stop"),
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /barcode scan · local item/i }));

    expect(screen.getByText("task screen")).toBeInTheDocument();
  });

  it("heads for the finish once every checkpoint is behind the car", async () => {
    getState.mockResolvedValue(state({ currentWaypointId: "w2", nextWaypointId: null }));
    renderPage();

    expect(await screen.findByText(/^finish$/i)).toBeInTheDocument();
  });

  it("hands navigation to Google Maps when another phone is sharing", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /navigate/i }));
    await act(async () => {});

    expect(openUrl).toHaveBeenCalledWith({
      url: "https://www.google.com/maps/dir/?api=1&destination=6.848,79.928&travelmode=driving",
    });
  });

  // Google Maps backgrounds the rally app; if this phone is the only one
  // reporting, the car goes dark. Advisory: the crew can still go.
  it("warns first when this phone is the only one sharing", async () => {
    getState.mockResolvedValue(state({ sharingCount: 1 }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /navigate/i }));

    expect(screen.getByText(/only phone sharing/i)).toBeInTheDocument();
    expect(openUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /navigate anyway/i }));
    await act(async () => {});

    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it("says so when Google Maps cannot be opened", async () => {
    openUrl.mockRejectedValue(new Error("requestOpenUrl timed out"));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /navigate/i }));

    expect(await screen.findByText(/could not open google maps/i)).toBeInTheDocument();
  });

  it("reaches the vehicle issue report", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /report vehicle issue/i }));

    expect(screen.getByText("report screen")).toBeInTheDocument();
  });

  it("explains a location failure and asks again on request", async () => {
    renderPage();
    await screen.findByText(/checkpoint 1/i);
    fail("services_disabled");

    expect(screen.getByText(/location is switched off/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(watches).toHaveLength(2);
  });

  it("sends a car that has finished to its arrival screen", async () => {
    getState.mockResolvedValue(state({ status: "finished" }));
    renderPage();

    expect(await screen.findByText("arrival screen")).toBeInTheDocument();
  });
});
