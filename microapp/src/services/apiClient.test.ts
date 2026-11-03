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

import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (window as unknown as { config: unknown }).config = { BACKEND_BASE_URL: "http://backend.test", IS_MICROAPP: false };
});

const { apiClient, ApiError } = await import("./apiClient");
const { useSessionStore } = await import("@/store/session");
import type { SessionModel } from "@/types/session.model";

let sent: InternalAxiosRequestConfig[];

/** Answers every request with `status` and `data`, rejecting as axios would for non-2xx. */
const respond =
  (status: number, data: unknown): AxiosAdapter =>
  async (config) => {
    sent.push(config);
    const response = { data, status, statusText: String(status), headers: {}, config };
    if (status >= 200 && status < 300) return response;
    throw new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_RESPONSE", config, null, response);
  };

beforeEach(() => {
  sent = [];
  useSessionStore.getState().clear();
  window.location.hash = "#/route";
});

describe("apiClient", () => {
  it("talks to the configured backend", () => {
    expect(apiClient.defaults.baseURL).toBe("http://backend.test");
  });

  // The backend reads Authorization only; customer-portal's x-user-id-token
  // copy was dropped on purpose (see CLAUDE.md).
  it("sends the team token as the bearer, and nothing else", async () => {
    useSessionStore.getState().setJoined("tok123", { id: "s1" } as SessionModel);
    apiClient.defaults.adapter = respond(200, {});

    await apiClient.get("/sessions/me");

    expect(sent[0].headers.Authorization).toBe("Bearer tok123");
    expect(sent[0].headers["x-user-id-token"]).toBeUndefined();
  });

  it("sends no Authorization before the crew has joined", async () => {
    apiClient.defaults.adapter = respond(200, {});

    await apiClient.get("/health");

    expect(sent[0].headers.Authorization).toBeUndefined();
  });

  // Joining carries the super app's token, which the team token must not overwrite.
  it("leaves an explicit Authorization header alone", async () => {
    useSessionStore.getState().setJoined("old-team-tok", { id: "s1" } as SessionModel);
    apiClient.defaults.adapter = respond(201, {});

    await apiClient.post("/sessions/join", {}, { headers: { Authorization: "Bearer super-app-tok" } });

    expect(sent[0].headers.Authorization).toBe("Bearer super-app-tok");
  });

  it("clears the session and sends the crew back to join on a 401", async () => {
    useSessionStore.getState().setJoined("expired", { id: "s1" } as SessionModel);
    apiClient.defaults.adapter = respond(401, { message: "Your session has expired." });

    await expect(apiClient.get("/sessions/me")).rejects.toBeInstanceOf(ApiError);

    expect(useSessionStore.getState().token).toBeNull();
    expect(window.location.hash).toBe("#/");
  });

  // Every non-2xx body is {"message": ...}. Screens show that sentence.
  it("surfaces the backend's message, with the status", async () => {
    apiClient.defaults.adapter = respond(409, { message: "This session has already finished." });

    const error = await apiClient.post("/sessions/me/finish").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).message).toBe("This session has already finished.");
    expect((error as InstanceType<typeof ApiError>).status).toBe(409);
  });

  it("says so plainly when the backend cannot be reached", async () => {
    apiClient.defaults.adapter = async (config) => {
      throw new AxiosError("Network Error", "ERR_NETWORK", config);
    };

    const error = await apiClient.get("/sessions/me").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as InstanceType<typeof ApiError>).status).toBe(0);
    expect((error as InstanceType<typeof ApiError>).message).toMatch(/reach/i);
  });
});
