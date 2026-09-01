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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import RoutesPage from "@features/routes/pages/RoutesPage";
import { ErrorBannerProvider } from "@context/error-banner/ErrorBannerContext";
import { SuccessBannerProvider } from "@context/success-banner/SuccessBannerContext";
import LoggerProvider from "@context/logger/LoggerProvider";
import type { RallyEvent } from "@/types/event";
import type { RallyRoute, Waypoint } from "@/types/route";
import type { RallyTask } from "@/types/task";

const rallyEvent: RallyEvent = {
  id: "e1",
  name: "Motor Rally 2027",
  eventDate: "2027-03-14",
  startTime: "09:00",
  status: "active",
  start: { label: "Diyatha Uyana grid", lat: 6.8901, lng: 79.92, radiusM: 40 },
  end: { label: "Pearl Bay", lat: 6.848, lng: 79.928, radiusM: 30 },
  cipher: "API Integration",
  createdBy: "organizer@wso2.com",
  createdOn: "2026-08-08T00:00:00Z",
  routes: [],
};

const routeList: RallyRoute[] = [
  { id: "r1", eventId: "e1", name: "Inland", order: 0 },
  { id: "r2", eventId: "e1", name: "Wetlands", order: 1 },
];

const waypoint = (id: string, order: number, label: string, taskIds: string[] = []): Waypoint => ({
  id,
  routeId: "r1",
  order,
  label,
  lat: 6.9 + order / 100,
  lng: 79.9,
  boundaryRadiusM: 50,
  taskIds,
});

const inland: RallyRoute = {
  ...routeList[0],
  waypoints: [
    waypoint("w1", 0, "Start grid"),
    waypoint("w2", 1, "Parliament Rd", ["t1"]),
    waypoint("w3", 2, "Maharagama"),
  ],
};

const wetlands: RallyRoute = { ...routeList[1], waypoints: [] };

const tasks: RallyTask[] = [
  {
    id: "t1",
    eventId: "e1",
    code: "T1",
    title: "Translation Cipher",
    type: "INPUT_SELECT",
    trigger: "geofence",
    points: 50,
    sensor: "none",
    config: {},
  },
];

const fetchMock = vi.fn();
const calls: { method: string; path: string; body?: unknown }[] = [];

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const routeRequest = (url: string, init?: RequestInit): Response => {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.replace("http://localhost:8080", "");
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, body });

  if (method === "POST" && path === "/events/search") {
    return jsonResponse({ items: [rallyEvent], totalCount: 1 });
  }
  if (method === "GET" && path === "/events/e1/routes") {
    return jsonResponse(routeList);
  }
  if (method === "GET" && path === "/routes/r1") {
    return jsonResponse(inland);
  }
  if (method === "GET" && path === "/routes/r2") {
    return jsonResponse(wetlands);
  }
  if (method === "POST" && path === "/events/e1/tasks/search") {
    return jsonResponse({ items: tasks, totalCount: tasks.length });
  }
  if (method === "PATCH" && path === "/routes/r1/waypoints/order") {
    return jsonResponse(inland);
  }
  if (method === "POST" && path === "/routes/r1/waypoints") {
    return jsonResponse({ ...body, id: "w4", routeId: "r1", order: 3, taskIds: [] }, 201);
  }
  if (method === "PATCH" && path === "/waypoints/w2") {
    return jsonResponse({ ...inland.waypoints![1], ...body });
  }
  if (method === "DELETE" && path === "/waypoints/w2") {
    return jsonResponse(inland);
  }
  if (method === "POST" && /^\/waypoints\/\w+\/tasks$/.test(path)) {
    return jsonResponse({ ...inland.waypoints![1], taskIds: body.taskIds });
  }
  if (method === "GET" && path === "/users/me") {
    return jsonResponse({ userId: "u1", email: "organizer@wso2.com", groups: [] });
  }

  return jsonResponse({ message: `Unexpected ${method} ${path}` }, 500);
};

const renderPage = (initialPath = "/routes") => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <LoggerProvider config={{ level: "ERROR", prefix: "test" }}>
      <QueryClientProvider client={queryClient}>
        <ErrorBannerProvider>
          <SuccessBannerProvider>
            <MemoryRouter initialEntries={[initialPath]}>
              <Routes>
                <Route path="/routes" element={<RoutesPage />} />
              </Routes>
            </MemoryRouter>
          </SuccessBannerProvider>
        </ErrorBannerProvider>
      </QueryClientProvider>
    </LoggerProvider>,
  );
};

const callsTo = (method: string, path: string) =>
  calls.filter((call) => call.method === method && call.path === path);

beforeEach(() => {
  fetchMock.mockReset();
  calls.length = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    routeRequest(url, init),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RoutesPage", () => {
  it("opens the event's first route and lists its waypoints in order", async () => {
    renderPage();

    expect(await screen.findByText("Parliament Rd")).toBeInTheDocument();
    expect(screen.getByText("Route 1 · Inland")).toBeInTheDocument();
    expect(screen.getByText("Route 2 · Wetlands")).toBeInTheDocument();
  });

  it("honours a route id from the query string", async () => {
    renderPage("/routes?routeId=r2");

    expect(await screen.findByText(/No waypoints yet/i)).toBeInTheDocument();
  });

  // A partial order is rejected by the backend, so the page must send the whole
  // permutation even though only two legs swapped.
  it("reorders by sending the full permutation", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Move Parliament Rd up" }));

    await waitFor(() => expect(callsTo("PATCH", "/routes/r1/waypoints/order")).toHaveLength(1));
    expect(callsTo("PATCH", "/routes/r1/waypoints/order")[0].body).toEqual({
      orderedIds: ["w2", "w1", "w3"],
    });
  });

  it("saves a new boundary radius as a PATCH on the waypoint", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText("Parliament Rd"));
    const panel = await screen.findByRole("group", { name: "Parliament Rd settings" });
    const radius = within(panel).getByLabelText(/Coordinate boundary radius/);
    await user.clear(radius);
    await user.type(radius, "120");
    await user.tab();

    await waitFor(() => expect(callsTo("PATCH", "/waypoints/w2")).toHaveLength(1));
    expect(callsTo("PATCH", "/waypoints/w2")[0].body).toEqual({ boundaryRadiusM: 120 });
  });

  // Attaching is a whole-set replace, so an "add" has to post the existing ids
  // plus the new one, not the new one alone.
  it("attaches a task by posting the whole set for that waypoint", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText("Maharagama"));
    const panel = await screen.findByRole("group", { name: "Maharagama settings" });
    await user.click(within(panel).getByLabelText("Add task"));
    await user.click(await screen.findByRole("option", { name: /T1/ }));

    await waitFor(() => expect(callsTo("POST", "/waypoints/w3/tasks")).toHaveLength(1));
    expect(callsTo("POST", "/waypoints/w3/tasks")[0].body).toEqual({ taskIds: ["t1"] });
  });

  it("removes a waypoint only after the confirmation is accepted", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText("Parliament Rd"));
    const panel = await screen.findByRole("group", { name: "Parliament Rd settings" });
    await user.click(within(panel).getByRole("button", { name: /Remove/ }));

    expect(callsTo("DELETE", "/waypoints/w2")).toHaveLength(0);

    const confirmation = await screen.findByRole("dialog");
    await user.click(within(confirmation).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(callsTo("DELETE", "/waypoints/w2")).toHaveLength(1));
  });

  it("surfaces the backend message when a reorder is refused", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = url.replace("http://localhost:8080", "");
      if (path === "/routes/r1/waypoints/order") {
        return jsonResponse(
          { message: "The new order must list all 3 waypoints of this route, got 2." },
          400,
        );
      }

      return routeRequest(url, init);
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Move Parliament Rd up" }));

    expect(
      await screen.findByText("The new order must list all 3 waypoints of this route, got 2."),
    ).toBeInTheDocument();
  });
});
