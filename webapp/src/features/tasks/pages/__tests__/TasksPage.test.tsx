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
import TasksPage from "@features/tasks/pages/TasksPage";
import { ErrorBannerProvider } from "@context/error-banner/ErrorBannerContext";
import { SuccessBannerProvider } from "@context/success-banner/SuccessBannerContext";
import LoggerProvider from "@context/logger/LoggerProvider";
import type { RallyEvent } from "@/types/event";
import type { RallyTask } from "@/types/task";

const event = (id: string, name: string, status: RallyEvent["status"]): RallyEvent => ({
  id,
  name,
  eventDate: "2027-03-14",
  startTime: "09:00",
  status,
  start: { label: "", lat: null, lng: null, radiusM: 0 },
  end: { label: "", lat: null, lng: null, radiusM: 0 },
  cipher: "",
  createdBy: "organizer@wso2.com",
  createdOn: "2026-08-08T00:00:00Z",
  routes: [],
});

const events = [event("e-setup", "Pilot Run", "setup"), event("e1", "Motor Rally 2027", "active")];

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
    config: { prompt: "Translate", answer: "API Integration" },
  },
  {
    id: "t4",
    eventId: "e1",
    code: "T4",
    title: "Eco-Driving Telematics",
    type: "TELEMATICS",
    trigger: "sensor",
    points: 80,
    sensor: "devicemotion",
    config: {},
  },
];

const fetchMock = vi.fn();
const patched: Record<string, unknown>[] = [];
const created: Record<string, unknown>[] = [];

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const routeRequest = (url: string, init?: RequestInit): Response => {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.replace("http://localhost:8080", "");
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;

  if (method === "POST" && path === "/events/search") {
    return jsonResponse({ items: events, totalCount: events.length });
  }
  if (method === "POST" && path === "/events/e1/tasks/search") {
    return jsonResponse({ items: tasks, totalCount: tasks.length });
  }
  if (method === "POST" && path === "/events/e-setup/tasks/search") {
    return jsonResponse({ items: [], totalCount: 0 });
  }
  if (method === "POST" && path === "/events/e1/tasks") {
    created.push(body);
    return jsonResponse({ ...body, id: "t-new", eventId: "e1" }, 201);
  }
  if (method === "PATCH" && path === "/tasks/t1") {
    patched.push(body);
    return jsonResponse({ ...tasks[0], ...body });
  }
  if (method === "GET" && path === "/users/me") {
    return jsonResponse({ userId: "u1", email: "organizer@wso2.com", groups: [] });
  }

  return jsonResponse({ message: `Unexpected ${method} ${path}` }, 500);
};

const renderPage = (initialPath = "/tasks") => {
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
                <Route path="/tasks" element={<TasksPage />} />
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
  patched.length = 0;
  created.length = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    routeRequest(url, init),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TasksPage", () => {
  // Nothing in the path says which event, so the page has to choose — and the
  // running rally is the one an organizer means during the event.
  it("defaults to the active event and lists its tasks", async () => {
    renderPage();

    expect(await screen.findByText("Translation Cipher")).toBeInTheDocument();
    expect(screen.getByText("Eco-Driving Telematics")).toBeInTheDocument();
    expect(screen.getByText("Accelerometer")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/· 2/)).toBeInTheDocument();
    });
  });

  it("honours an event id from the query string", async () => {
    renderPage("/tasks?eventId=e-setup");

    expect(await screen.findByText(/No tasks yet/i)).toBeInTheDocument();
  });

  it("saves an edited task through PATCH", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Answer"));
    await user.type(within(dialog).getByLabelText("Answer"), "Data Mesh");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toMatchObject({
      code: "T1",
      config: { answer: "Data Mesh", prompt: "Translate" },
    });
  });

  // T1 and T4 are taken, so the next free code is T2 rather than T5.
  it("opens a new task with the next free code", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Translation Cipher");
    await user.click(screen.getByRole("button", { name: /Task/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Code")).toHaveValue("T2");
  });

  it("surfaces the backend message when a save is refused", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = url.replace("http://localhost:8080", "");
      if (path === "/tasks/t1") {
        return jsonResponse({ message: "Unknown task type \"NOPE\"." }, 400);
      }
      return routeRequest(url, init);
    });
    renderPage();

    await user.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText('Unknown task type "NOPE".')).toBeInTheDocument();
  });
});
