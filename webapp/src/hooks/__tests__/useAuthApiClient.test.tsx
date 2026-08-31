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
import { renderHook } from "@testing-library/react";
import { useAuthApiClient } from "@hooks/useAuthApiClient";
import { ApiError } from "@utils/ApiError";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

const lastRequest = (): [string, RequestInit] =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];

describe("useAuthApiClient", () => {
  it("prefixes the backend base url and sends both auth headers", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));
    const { result } = renderHook(() => useAuthApiClient());

    await result.current.authFetch("/events/search", { method: "POST", body: "{}" });

    const [url, options] = lastRequest();
    expect(url).toBe("http://localhost:8080/events/search");
    const headers = options.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer mock-id-token");
    expect(headers.get("x-user-id-token")).toBe("mock-id-token");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  // FormData carries its own multipart boundary; setting Content-Type by hand
  // would strip it and the CSV import would fail to parse server-side.
  it("leaves the content type alone for FormData bodies", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const { result } = renderHook(() => useAuthApiClient());

    await result.current.authFetch("/upload", {
      method: "POST",
      body: new FormData(),
    });

    expect((lastRequest()[1].headers as Headers).has("Content-Type")).toBe(false);
  });

  it("throws an ApiError carrying the backend message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { message: "Both geofences must be placed before publishing." },
        { status: 400, statusText: "Bad Request" },
      ),
    );
    const { result } = renderHook(() => useAuthApiClient());

    const error = await result.current
      .authFetch("/events/e1/publish", { method: "POST" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe(
      "Both geofences must be placed before publishing.",
    );
  });

  // A gateway 503 answers with infra text, not a user-facing sentence.
  it("substitutes friendly copy for gateway unavailability", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>upstream timeout</html>", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );
    const { result } = renderHook(() => useAuthApiClient());

    const error = (await result.current
      .authFetch("/events")
      .catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(503);
    expect(error.message).toMatch(/temporarily unavailable/i);
  });

  it("returns parsed JSON through authJson", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "e1", name: "Motor Rally 2027" }));
    const { result } = renderHook(() => useAuthApiClient());

    await expect(result.current.authJson<{ id: string }>("/events/e1")).resolves.toEqual({
      id: "e1",
      name: "Motor Rally 2027",
    });
  });

  // A 204 has no body; parsing it as JSON would throw on a successful delete.
  it("returns undefined for an empty response body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { result } = renderHook(() => useAuthApiClient());

    await expect(result.current.authJson("/events/e1")).resolves.toBeUndefined();
  });
});
