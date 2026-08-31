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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { ASGARDEO_UNAUTHENTICATED_CODE } from "@constants/apiConstants";
import { useAuthApiClient } from "@hooks/useAuthApiClient";

const expired = Object.assign(new Error("expired"), {
  code: ASGARDEO_UNAUTHENTICATED_CODE,
});

const signInMock = vi.fn();
const getIdTokenMock = vi.fn();

// Overrides the global mock in vitest.setup.ts so this file can make signIn
// fail, which the shared mock cannot express.
vi.mock("@asgardeo/react", () => ({
  useAsgardeo: () => ({
    isSignedIn: true,
    isLoading: false,
    user: { email: "organizer@wso2.com" },
    signIn: signInMock,
    signOut: vi.fn(),
    getIdToken: getIdTokenMock,
    getAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
  }),
  AsgardeoProvider: ({ children }: { children: unknown }) => children,
}));

beforeEach(() => {
  signInMock.mockReset();
  getIdTokenMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

describe("useAuthApiClient sign-in failure", () => {
  // A redirect never settles on purpose — the browser is leaving. But if
  // signIn() itself rejects there is no navigation coming, so a promise that
  // never settles strands the caller with no error and no page.
  it("rejects instead of hanging when signIn() fails", async () => {
    getIdTokenMock.mockRejectedValue(expired);
    signInMock.mockRejectedValue(new Error("redirect blocked"));

    const { result } = renderHook(() => useAuthApiClient());

    await expect(result.current.authFetch("/events")).rejects.toThrow(
      /redirect blocked/,
    );
  }, 2000);
});
