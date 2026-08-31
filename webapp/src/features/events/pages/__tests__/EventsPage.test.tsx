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
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import EventsPage from "@features/events/pages/EventsPage";
import EventSetupPage from "@features/events/pages/EventSetupPage";
import { ErrorBannerProvider } from "@context/error-banner/ErrorBannerContext";
import { SuccessBannerProvider } from "@context/success-banner/SuccessBannerContext";
import LoggerProvider from "@context/logger/LoggerProvider";
import type { RallyEvent } from "@/types/event";

const rally: RallyEvent = {
  id: "e1",
  name: "Motor Rally 2027",
  eventDate: "2027-03-14",
  startTime: "09:00",
  status: "setup",
  start: { label: "Diyatha Uyana grid", lat: 6.8901, lng: 79.92, radiusM: 40 },
  end: { label: "Pearl Bay", lat: 6.848, lng: 79.928, radiusM: 30 },
  cipher: "API Integration",
  createdBy: "organizer@wso2.com",
  createdOn: "2026-08-07T00:00:00Z",
  routes: [
    { id: "r1", name: "Inland" },
    { id: "r2", name: "Wetlands" },
  ],
};

const fetchMock = vi.fn();

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Routes a request by method + path to the backend shape under test. */
const routeRequest = (url: string, init?: RequestInit): Response => {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.replace("http://localhost:8080", "");

  if (method === "POST" && path === "/events/search") {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      filters?: { status?: string };
    };
    const items = body.filters?.status === "active" ? [] : [rally];

    return jsonResponse({ items, totalCount: items.length });
  }
  if (method === "GET" && path === "/events/e1/stats") {
    return jsonResponse({ vehicles: 150, crews: 600, tasks: 15, openAlerts: 3 });
  }
  if (method === "GET" && path === "/events/e1") {
    return jsonResponse(rally);
  }
  if (method === "POST" && path === "/events/e1/publish") {
    return jsonResponse(
      { message: "Both the start and end geofence must be placed before publishing." },
      400,
    );
  }
  if (method === "GET" && path === "/users/me") {
    return jsonResponse({ userId: "u1", email: "organizer@wso2.com", groups: [] });
  }

  return jsonResponse({ message: `Unexpected ${method} ${path}` }, 500);
};

const renderApp = (initialPath: string) => {
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
                <Route path="/events" element={<EventsPage />} />
                <Route path="/events/:eventId/setup" element={<EventSetupPage />} />
              </Routes>
            </MemoryRouter>
          </SuccessBannerProvider>
        </ErrorBannerProvider>
      </QueryClientProvider>
    </LoggerProvider>,
  );
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    routeRequest(url, init),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EventsPage", () => {
  it("renders the searched events with their stat cards", async () => {
    renderApp("/events");

    expect(await screen.findByText("Motor Rally 2027")).toBeInTheDocument();
    expect(screen.getByText("Inland + Wetlands")).toBeInTheDocument();
    expect(screen.getByText("09:00 AM")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Vehicles").parentElement).toHaveTextContent("150");
    });
    expect(screen.getByText("Crews").parentElement).toHaveTextContent("600");
    expect(
      screen.getByRole("button", { name: /view 3 open alerts/i }),
    ).toBeInTheDocument();
  });

  it("navigates to setup when a row is opened", async () => {
    const user = userEvent.setup();
    renderApp("/events");

    await user.click(await screen.findByRole("button", { name: "Edit" }));

    expect(
      await screen.findByText(/Event setup · Motor Rally 2027/),
    ).toBeInTheDocument();
  });
});

describe("EventSetupPage", () => {
  it("loads the event into the form", async () => {
    renderApp("/events/e1/setup");

    expect(await screen.findByLabelText(/event name/i)).toHaveValue(
      "Motor Rally 2027",
    );
    expect(screen.getByLabelText(/cipher/i)).toHaveValue("API Integration");
  });

  // The client pre-check can pass while the server still refuses (e.g. the
  // stored boundary lost its pin). The backend's own sentence must reach the
  // organizer rather than a generic failure.
  it("surfaces the backend message when publishing is refused", async () => {
    const user = userEvent.setup();
    renderApp("/events/e1/setup");

    await user.click(await screen.findByRole("button", { name: /publish/i }));

    expect(
      await screen.findByText(
        "Both the start and end geofence must be placed before publishing.",
      ),
    ).toBeInTheDocument();
  });
});
