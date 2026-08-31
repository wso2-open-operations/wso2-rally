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

import { describe, it, expect, beforeEach } from "vitest";
import { getApiConfig, getWebSocketUrl } from "@config/apiConfig";
import type { RallyWindowConfig } from "@config/portalConfig";

const setConfig = (config: Partial<RallyWindowConfig>): void => {
  window.config = config as RallyWindowConfig;
};

describe("getApiConfig", () => {
  beforeEach(() => {
    setConfig({});
  });

  it("throws when the backend url is missing", () => {
    expect(() => getApiConfig()).toThrow(/RALLY_BACKEND_BASE_URL/);
  });

  it("returns the configured url", () => {
    setConfig({ RALLY_BACKEND_BASE_URL: "https://api.example.com" });

    expect(getApiConfig().backendBaseUrl).toBe("https://api.example.com");
  });

  // Hooks build paths as `${backendBaseUrl}/events`, so a trailing slash would
  // produce a double slash the gateway may not route.
  it("strips a trailing slash", () => {
    setConfig({ RALLY_BACKEND_BASE_URL: "https://api.example.com/v1/" });

    expect(getApiConfig().backendBaseUrl).toBe("https://api.example.com/v1");
  });
});

describe("getWebSocketUrl", () => {
  it("derives ws from http and wss from https", () => {
    setConfig({ RALLY_BACKEND_BASE_URL: "http://localhost:8080" });
    expect(getWebSocketUrl()).toBe("ws://localhost:8080/ws");

    setConfig({ RALLY_BACKEND_BASE_URL: "https://api.example.com/v1" });
    expect(getWebSocketUrl()).toBe("wss://api.example.com/v1/ws");
  });
});

describe("getApiConfig — origin safety", () => {
  // The base URL is the fetch target that carries the organizer's id token.
  // A non-loopback http:// origin puts that token on the wire in cleartext,
  // so a deployment typo must fail loudly at startup rather than silently.
  it("rejects a non-loopback http origin", () => {
    window.config = {
      ...window.config,
      RALLY_BACKEND_BASE_URL: "http://rally.example.com",
    } as typeof window.config;

    expect(() => getApiConfig()).toThrow(/https/i);
  });

  it("allows http on loopback, where there is no network to observe", () => {
    window.config = {
      ...window.config,
      RALLY_BACKEND_BASE_URL: "http://localhost:8080",
    } as typeof window.config;

    expect(getApiConfig().backendBaseUrl).toBe("http://localhost:8080");
  });

  it("rejects a url carrying credentials", () => {
    window.config = {
      ...window.config,
      RALLY_BACKEND_BASE_URL: "https://user:pass@rally.example.com",
    } as typeof window.config;

    expect(() => getApiConfig()).toThrow();
  });

  it("rejects a url carrying a query string or fragment", () => {
    window.config = {
      ...window.config,
      RALLY_BACKEND_BASE_URL: "https://rally.example.com/?a=1",
    } as typeof window.config;

    expect(() => getApiConfig()).toThrow();
  });

  it("rejects a value that is not an absolute url", () => {
    window.config = {
      ...window.config,
      RALLY_BACKEND_BASE_URL: "rally.example.com",
    } as typeof window.config;

    expect(() => getApiConfig()).toThrow();
  });
});
