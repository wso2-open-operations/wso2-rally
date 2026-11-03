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

import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (window as unknown as { config: unknown }).config = {
    BACKEND_BASE_URL: "http://backend.test",
    IS_MICROAPP: false,
    DEV_SUPER_APP_TOKEN: "super-app-tok",
  };
});

const { apiClient } = await import("./apiClient");
const { useSessionStore } = await import("@/store/session");
const vehicles = await import("./vehicles");

let sent: InternalAxiosRequestConfig[];

const replyWith =
  (body: unknown): AxiosAdapter =>
  async (config) => {
    sent.push(config);
    return { data: body, status: 200, statusText: "OK", headers: {}, config };
  };

beforeEach(() => {
  sent = [];
  useSessionStore.getState().clear();
});

describe("listJoinableVehicles", () => {
  // Read before joining, so there is no team token — the super app's identity
  // is what the backend matches against the crew lists.
  it("asks with the super app's token, not a team token", async () => {
    useSessionStore.getState().setToken("stale-team-tok");
    apiClient.defaults.adapter = replyWith([]);

    await vehicles.listJoinableVehicles();

    expect(sent[0].url).toBe("/sessions/joinable");
    expect(sent[0].method).toBe("get");
    expect(sent[0].headers.Authorization).toBe("Bearer super-app-tok");
  });

  it("maps the cars", async () => {
    apiClient.defaults.adapter = replyWith([
      {
        vehicleId: "v1",
        code: "PKT-001",
        teamName: "Data Dashers",
        eventId: "e1",
        eventName: "Motor Rally 2027",
        eventDate: "2027-02-13",
        startTime: "09:00",
      },
    ]);

    await expect(vehicles.listJoinableVehicles()).resolves.toEqual([
      {
        vehicleId: "v1",
        code: "PKT-001",
        teamName: "Data Dashers",
        eventId: "e1",
        eventName: "Motor Rally 2027",
        eventDate: "2027-02-13",
        startTime: "09:00",
      },
    ]);
  });

  // The backend answers [] — but a null would otherwise crash the screen.
  it("treats a missing list as no cars", async () => {
    apiClient.defaults.adapter = replyWith(null);

    await expect(vehicles.listJoinableVehicles()).resolves.toEqual([]);
  });

  it("is exposed as TanStack query options", () => {
    const options = vehicles.vehicles.joinable();

    expect(options.queryKey).toEqual(["vehicles", "joinable"]);
  });
});
