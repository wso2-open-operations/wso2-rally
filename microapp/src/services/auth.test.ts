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

import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (config: Record<string, unknown>) => {
  vi.resetModules();
  (window as unknown as { config: unknown }).config = { BACKEND_BASE_URL: "http://backend.test", ...config };

  return import("./auth");
};

afterEach(() => {
  delete (window as unknown as { nativebridge?: unknown }).nativebridge;
});

describe("getSuperAppToken", () => {
  it("asks the super app for its token when embedded", async () => {
    const bridge: Record<string, (t?: string) => void> = {};
    bridge.requestToken = () => bridge.resolveToken("asgardeo-from-host");
    (window as unknown as { nativebridge: unknown }).nativebridge = bridge;
    const { getSuperAppToken } = await load({ IS_MICROAPP: true });

    await expect(getSuperAppToken()).resolves.toBe("asgardeo-from-host");
  });

  // IS_MICROAPP says the app expects a host. A missing bridge is then a
  // packaging or configuration fault, and saying so beats a silent fallback.
  it("fails clearly when IS_MICROAPP is set but there is no super app", async () => {
    const { getSuperAppToken } = await load({ IS_MICROAPP: true });

    await expect(getSuperAppToken()).rejects.toThrow(/not running inside the super app/i);
  });

  it("uses the configured development token in a desktop browser", async () => {
    const { getSuperAppToken } = await load({ IS_MICROAPP: false, DEV_SUPER_APP_TOKEN: "dev.jwt.token" });

    await expect(getSuperAppToken()).resolves.toBe("dev.jwt.token");
  });

  it("explains what to set when a desktop browser has no development token", async () => {
    const { getSuperAppToken } = await load({ IS_MICROAPP: false });

    await expect(getSuperAppToken()).rejects.toThrow(/DEV_SUPER_APP_TOKEN/);
  });
});

describe("emailFromToken", () => {
  /** base64url of the UTF-8 bytes — how a token issuer encodes a payload. */
  const b64url = (value: object) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const jwt = (claims: object) => `${b64url({ alg: "RS256" })}.${b64url(claims)}.sig`;

  // Display only: the screen says who is signed in. The backend, not this,
  // decides who the caller is.
  it("reads the email claim to show who is signed in", async () => {
    const { emailFromToken } = await load({ IS_MICROAPP: false });

    expect(emailFromToken(jwt({ email: "nimal@wso2.com" }))).toBe("nimal@wso2.com");
  });

  it("is null for a token with no email, or one it cannot read", async () => {
    const { emailFromToken } = await load({ IS_MICROAPP: false });

    expect(emailFromToken(jwt({ sub: "x" }))).toBeNull();
    expect(emailFromToken("not-a-jwt")).toBeNull();
    expect(emailFromToken("a.%%%.c")).toBeNull();
  });

  // base64url, not base64 — '-' and '_' appear in real tokens — and the
  // payload is UTF-8, so a name outside ASCII must survive the round trip.
  it("handles base64url and UTF-8 payloads", async () => {
    const { emailFromToken } = await load({ IS_MICROAPP: false });
    const email = "ñandú+rally>>?@wso2.com";

    expect(emailFromToken(jwt({ email }))).toBe(email);
  });
});
