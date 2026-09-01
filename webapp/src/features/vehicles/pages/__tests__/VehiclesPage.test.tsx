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
import VehiclesPage from "@features/vehicles/pages/VehiclesPage";
import { ErrorBannerProvider } from "@context/error-banner/ErrorBannerContext";
import { SuccessBannerProvider } from "@context/success-banner/SuccessBannerContext";
import LoggerProvider from "@context/logger/LoggerProvider";
import type { RallyEvent } from "@/types/event";
import type { RallyRoute } from "@/types/route";
import type { Vehicle } from "@/types/vehicle";

const rallyEvent: RallyEvent = {
  id: "e1",
  name: "Motor Rally 2027",
  eventDate: "2027-03-14",
  startTime: "09:00",
  status: "active",
  start: { label: "", lat: null, lng: null, radiusM: 0 },
  end: { label: "", lat: null, lng: null, radiusM: 0 },
  cipher: "",
  createdBy: "organizer@wso2.com",
  createdOn: "2026-08-08T00:00:00Z",
  routes: [],
};

const routes: RallyRoute[] = [
  { id: "r1", eventId: "e1", name: "Inland", order: 0 },
  { id: "r2", eventId: "e1", name: "Wetlands", order: 1 },
];

const vehicles: Vehicle[] = [
  {
    id: "v1",
    eventId: "e1",
    code: "PKT-001",
    teamName: "Data Dashers",
    vehicleType: "SUV",
    contactNumber: "071 234 5678",
    routeId: "r1",
    status: "ok",
    crew: [
      {
        id: "c1",
        name: "Nimal Perera",
        phoneNumber: "0771234567",
        role: "navigator",
        originCountry: "LK",
      },
    ],
  },
  {
    id: "v2",
    eventId: "e1",
    code: "PKT-002",
    teamName: "Sync Squad",
    vehicleType: "Sedan",
    contactNumber: "077 987 6543",
    routeId: "r2",
    status: "ok",
    crew: [],
  },
];

const fetchMock = vi.fn();
const calls: { method: string; path: string; body?: unknown; raw?: BodyInit | null }[] = [];

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const routeRequest = (url: string, init?: RequestInit): Response => {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.replace("http://localhost:8080", "");
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const body = init?.body && !isForm ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, body, raw: init?.body ?? null });

  if (method === "POST" && path === "/events/search") {
    return jsonResponse({ items: [rallyEvent], totalCount: 1 });
  }
  if (method === "GET" && path === "/events/e1/routes") {
    return jsonResponse(routes);
  }
  if (method === "POST" && path === "/events/e1/vehicles/search") {
    const query = String(body?.filters?.query ?? "").toLowerCase();
    const routeId = String(body?.filters?.routeId ?? "");
    const matched = vehicles.filter(
      (vehicle) =>
        (query === "" ||
          vehicle.code.toLowerCase().includes(query) ||
          vehicle.teamName.toLowerCase().includes(query)) &&
        (routeId === "" || vehicle.routeId === routeId),
    );

    return jsonResponse({ items: matched, totalCount: matched.length });
  }
  if (method === "POST" && path === "/events/e1/vehicles") {
    return jsonResponse({ ...body, id: "v-new", eventId: "e1", status: "ok" }, 201);
  }
  if (method === "PATCH" && path === "/vehicles/v1") {
    return jsonResponse({ ...vehicles[0], ...body });
  }
  if (method === "DELETE" && path === "/vehicles/v2") {
    return new Response(null, { status: 204 });
  }
  if (method === "POST" && path === "/events/e1/vehicles/import") {
    return jsonResponse({ imported: 42 });
  }
  if (method === "GET" && path === "/events/e1/vehicles/export") {
    return new Response("code,team_name\nPKT-001,Data Dashers\n", {
      status: 200,
      headers: { "Content-Type": "text/csv" },
    });
  }
  if (method === "GET" && path === "/users/me") {
    return jsonResponse({ userId: "u1", email: "organizer@wso2.com", groups: [] });
  }

  return jsonResponse({ message: `Unexpected ${method} ${path}` }, 500);
};

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <LoggerProvider config={{ level: "ERROR", prefix: "test" }}>
      <QueryClientProvider client={queryClient}>
        <ErrorBannerProvider>
          <SuccessBannerProvider>
            <MemoryRouter initialEntries={["/vehicles"]}>
              <Routes>
                <Route path="/vehicles" element={<VehiclesPage />} />
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

describe("VehiclesPage", () => {
  it("lists the event's fleet with its crew counts and routes", async () => {
    renderPage();

    expect(await screen.findByText("Data Dashers")).toBeInTheDocument();
    expect(screen.getByText("Sync Squad")).toBeInTheDocument();
    expect(screen.getByText("Inland")).toBeInTheDocument();
  });

  // 150 cars is the documented scale, so the filter has to reach the server
  // rather than narrowing whatever happens to be on the current page.
  it("pushes the search text to the backend as a filter", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Data Dashers");
    await user.type(screen.getByLabelText("Find a vehicle"), "squad");

    await waitFor(() => {
      const searches = callsTo("POST", "/events/e1/vehicles/search");
      expect(searches.at(-1)?.body).toMatchObject({ filters: { query: "squad" } });
    });
    await waitFor(() => {
      expect(screen.queryByText("Data Dashers")).not.toBeInTheDocument();
    });
  });

  it("creates a vehicle with its whole crew in one call", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Data Dashers");
    await user.click(screen.getByRole("button", { name: /Vehicle/ }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Vehicle code/), "PKT-009");
    await user.type(within(dialog).getByLabelText(/Team name/), "Null Pointers");
    await user.click(within(dialog).getByRole("button", { name: /Crew member/ }));
    await user.type(within(dialog).getByLabelText(/Name/), "Kasun");
    await user.type(within(dialog).getByLabelText(/Phone/), "0771234567");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(callsTo("POST", "/events/e1/vehicles")).toHaveLength(1));
    expect(callsTo("POST", "/events/e1/vehicles")[0].body).toMatchObject({
      code: "PKT-009",
      teamName: "Null Pointers",
      crew: [{ name: "Kasun", phoneNumber: "0771234567" }],
    });
  });

  // The backend rejects the whole vehicle over one bad crew row, so catching it
  // here saves a round trip that would discard the organizer's typing.
  it("refuses to send a crew member with no usable phone number", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Data Dashers");
    await user.click(screen.getByRole("button", { name: /Vehicle/ }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Vehicle code/), "PKT-009");
    await user.type(within(dialog).getByLabelText(/Team name/), "Null Pointers");
    await user.click(within(dialog).getByRole("button", { name: /Crew member/ }));
    await user.type(within(dialog).getByLabelText(/Name/), "Kasun");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(/needs a name and a phone number/i)).toBeInTheDocument();
    expect(callsTo("POST", "/events/e1/vehicles")).toHaveLength(0);
  });

  it("uploads the chosen CSV as a multipart file field", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Data Dashers");
    await user.click(screen.getByRole("button", { name: "Import from CSV" }));

    const dialog = await screen.findByRole("dialog");
    const file = new File(["code,team_name\n"], "fleet.csv", { type: "text/csv" });
    await user.upload(within(dialog).getByLabelText("Vehicle CSV file"), file);
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(callsTo("POST", "/events/e1/vehicles/import")).toHaveLength(1),
    );
    const sent = callsTo("POST", "/events/e1/vehicles/import")[0].raw;
    expect(sent).toBeInstanceOf(FormData);
    expect((sent as FormData).get("file")).toBe(file);
    expect(await screen.findByText(/42 vehicles imported/)).toBeInTheDocument();
  });

  it("surfaces the backend's refusal to delete a vehicle that has run", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = url.replace("http://localhost:8080", "");
      if (path === "/vehicles/v2" && init?.method === "DELETE") {
        return jsonResponse(
          { message: "This vehicle has already run, so it can be corrected but not deleted." },
          409,
        );
      }

      return routeRequest(url, init);
    });
    renderPage();

    await screen.findByText("Sync Squad");
    await user.click(screen.getByRole("button", { name: "Remove PKT-002" }));
    const confirmation = await screen.findByRole("dialog");
    await user.click(within(confirmation).getByRole("button", { name: "Remove" }));

    expect(
      await screen.findByText(/already run, so it can be corrected but not deleted/),
    ).toBeInTheDocument();
  });
});
