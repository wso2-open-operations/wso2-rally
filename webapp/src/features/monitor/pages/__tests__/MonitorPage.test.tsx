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
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import MonitorPage from "@features/monitor/pages/MonitorPage";
import { BEARER_SUBPROTOCOL } from "@hooks/useEventSocket";
import { ErrorBannerProvider } from "@context/error-banner/ErrorBannerContext";
import { SuccessBannerProvider } from "@context/success-banner/SuccessBannerContext";
import LoggerProvider from "@context/logger/LoggerProvider";
import type { RallyEvent } from "@/types/event";
import type { MonitorSnapshot } from "@/types/monitor";

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

const snapshot: MonitorSnapshot = {
  openAlerts: 0,
  vehicles: [
    {
      vehicleCode: "PKT-001",
      teamName: "Data Dashers",
      status: "ok",
      sessionStatus: "active",
      done: 10,
      totalTasks: 15,
      totalScore: 420,
      lastLat: 6.89,
      lastLng: 79.92,
      lastSeenAt: "2027-02-13T09:30:00Z",
    },
    {
      vehicleCode: "PKT-002",
      teamName: "Sync Squad",
      status: "ok",
      sessionStatus: "active",
      done: 7,
      totalTasks: 15,
      totalScore: 300,
      lastLat: null,
      lastLng: null,
      lastSeenAt: null,
    },
  ],
};

/** A WebSocket stand-in the test drives by hand. */
class FakeSocket {
  static instances: FakeSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((frame: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((closeEvent: CloseEvent) => void) | null = null;
  closed: { code?: number; reason?: string } | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
  ) {
    FakeSocket.instances.push(this);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" } as CloseEvent);
  }

  /** Drives the handshake the browser would complete. */
  open(): void {
    act(() => {
      this.onopen?.();
    });
  }

  send(payload: unknown): void {
    act(() => {
      this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
    });
  }

  sendRaw(data: string): void {
    act(() => {
      this.onmessage?.({ data } as MessageEvent<string>);
    });
  }
}

const fetchMock = vi.fn();
let snapshotRequests = 0;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const routeRequest = (url: string, init?: RequestInit): Response => {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.replace("http://localhost:8080", "");

  if (method === "POST" && path === "/events/search") {
    return jsonResponse({ items: [rallyEvent], totalCount: 1 });
  }
  if (method === "GET" && path === "/events/e1/monitor") {
    snapshotRequests += 1;
    return jsonResponse(snapshot);
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
            <MemoryRouter initialEntries={["/monitor"]}>
              <Routes>
                <Route path="/monitor" element={<MonitorPage />} />
              </Routes>
            </MemoryRouter>
          </SuccessBannerProvider>
        </ErrorBannerProvider>
      </QueryClientProvider>
    </LoggerProvider>,
  );
};

/** Waits for the hook's async token read to produce a socket. */
const nextSocket = async (index = 0): Promise<FakeSocket> => {
  await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(index));

  return FakeSocket.instances[index];
};

beforeEach(() => {
  fetchMock.mockReset();
  FakeSocket.instances = [];
  snapshotRequests = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    routeRequest(url, init),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MonitorPage", () => {
  it("seeds the completion matrix from the REST snapshot", async () => {
    renderPage();

    expect(await screen.findByText("10/15")).toBeInTheDocument();
    expect(screen.getByText("7/15")).toBeInTheDocument();
  });

  // The browser cannot set an Authorization header on a handshake, so the token
  // rides in the subprotocol list — and must never be in the URL, which the
  // backend logs.
  it("subscribes to the event topic with the token in the subprotocol", async () => {
    renderPage();

    const socket = await nextSocket();

    expect(socket.url).toBe("ws://localhost:8080/ws?topic=event:e1");
    expect(socket.protocols).toEqual([BEARER_SUBPROTOCOL, "mock-id-token"]);
    expect(socket.url).not.toContain("mock-id-token");
  });

  it("shows the live chip only once the socket is open", async () => {
    renderPage();
    const socket = await nextSocket();

    expect(screen.queryByText("● WebSocket live")).not.toBeInTheDocument();
    socket.open();

    expect(await screen.findByText("● WebSocket live")).toBeInTheDocument();
  });

  it("advances a vehicle's completion count from a task_completed frame", async () => {
    renderPage();
    await screen.findByText("7/15");
    const socket = await nextSocket();
    socket.open();

    socket.send({ type: "task_completed", vehicleCode: "PKT-002", taskCode: "T8" });

    expect(await screen.findByText("8/15")).toBeInTheDocument();
  });

  it("raises the open-alert count from an alert frame", async () => {
    renderPage();
    await screen.findByText("10/15");
    const socket = await nextSocket();
    socket.open();

    socket.send({
      type: "alert",
      alert: {
        id: "a1",
        vehicleId: "v1",
        type: "breakdown",
        note: "Flat tyre near Kelani bridge",
        source: "crew",
        raisedAt: "2027-02-13T10:00:00Z",
        resolvedAt: null,
      },
    });

    expect(await screen.findByText("Flat tyre near Kelani bridge")).toBeInTheDocument();
    expect(screen.getByText("1 open")).toBeInTheDocument();
  });

  // A malformed frame is untrusted input arriving mid-rally; it must not take
  // the monitor down.
  it("ignores a junk frame and keeps rendering", async () => {
    renderPage();
    await screen.findByText("10/15");
    const socket = await nextSocket();
    socket.open();

    socket.sendRaw("}{ not json");
    socket.send({ type: "vehicle_position", vehicleCode: "PKT-002" });

    expect(screen.getByText("10/15")).toBeInTheDocument();
  });

  // The hub sends no history, so whatever was broadcast while the socket was
  // down is gone — the snapshot is the only way back to a true state.
  it("refetches the snapshot after a reconnect, not on the first open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage();
      const socket = await nextSocket();
      socket.open();
      await waitFor(() => expect(snapshotRequests).toBe(1));

      socket.close(1006, "network dropped");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });

      const reconnected = await nextSocket(1);
      reconnected.open();

      await waitFor(() => expect(snapshotRequests).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("says it is reconnecting rather than pretending the map is live", async () => {
    renderPage();
    const socket = await nextSocket();
    socket.open();
    await screen.findByText("● WebSocket live");

    socket.close(1006, "network dropped");

    expect(
      await screen.findByText(/Reconnecting — showing the last known state/),
    ).toBeInTheDocument();
  });

  it("closes the socket cleanly when the page unmounts", async () => {
    const { unmount } = renderPage();
    const socket = await nextSocket();
    socket.open();

    unmount();

    expect(socket.closed?.code).toBe(1000);
  });
});
