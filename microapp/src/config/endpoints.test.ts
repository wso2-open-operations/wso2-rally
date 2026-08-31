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

import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `endpoints` reads `window.config` at import time and throws when it is not
 * there, so every case needs a fresh module — hence `resetModules` and a
 * dynamic import rather than a top-level one.
 */
const loadEndpoints = async () => {
  vi.resetModules();

  return import("./endpoints");
};

describe("endpoints", () => {
  beforeEach(() => {
    delete (window as unknown as { config?: unknown }).config;
  });

  // Failing loudly at startup beats a micro app that renders and then 404s
  // every call against `undefined/sessions/me`.
  it("throws when BACKEND_BASE_URL is missing", async () => {
    (window as unknown as { config: unknown }).config = { IS_MICROAPP: true };

    await expect(loadEndpoints()).rejects.toThrow(/BACKEND_BASE_URL/);
  });

  it("throws when there is no config at all", async () => {
    await expect(loadEndpoints()).rejects.toThrow(/BACKEND_BASE_URL/);
  });

  it("exposes the backend URL without a trailing slash", async () => {
    (window as unknown as { config: unknown }).config = {
      BACKEND_BASE_URL: "https://rally.example.com/api/",
    };

    const { BACKEND_URL } = await loadEndpoints();

    expect(BACKEND_URL).toBe("https://rally.example.com/api");
  });

  // One host is configured, not two: a deployment that had to keep an http and
  // a ws URL in step would eventually get them out of step.
  it("derives the websocket URL from it", async () => {
    (window as unknown as { config: unknown }).config = {
      BACKEND_BASE_URL: "https://rally.example.com",
    };

    const { WS_URL } = await loadEndpoints();

    expect(WS_URL).toBe("wss://rally.example.com/ws");
  });

  it("derives an insecure websocket for local development", async () => {
    (window as unknown as { config: unknown }).config = {
      BACKEND_BASE_URL: "http://localhost:8080",
    };

    const { WS_URL } = await loadEndpoints();

    expect(WS_URL).toBe("ws://localhost:8080/ws");
  });

  // IS_MICROAPP selects the bridge token path over a browser OIDC sign-in, so
  // anything other than an explicit `true` has to mean "running in a browser".
  it("treats IS_MICROAPP as embedded only when it is exactly true", async () => {
    for (const [value, expected] of [
      [true, true],
      [false, false],
      ["true", false],
      [undefined, false],
    ] as const) {
      (window as unknown as { config: unknown }).config = {
        BACKEND_BASE_URL: "http://localhost:8080",
        IS_MICROAPP: value,
      };

      const { IS_MICROAPP } = await loadEndpoints();

      expect(IS_MICROAPP, `IS_MICROAPP: ${String(value)}`).toBe(expected);
    }
  });

  it("builds the per-task paths", async () => {
    (window as unknown as { config: unknown }).config = {
      BACKEND_BASE_URL: "http://localhost:8080",
    };

    const { TASK, SUBMIT, SESSIONS_JOIN } = await loadEndpoints();

    expect(SESSIONS_JOIN).toBe("/sessions/join");
    expect(TASK("abc")).toBe("/tasks/abc");
    expect(SUBMIT("abc")).toBe("/sessions/me/tasks/abc/submit");
  });
});
