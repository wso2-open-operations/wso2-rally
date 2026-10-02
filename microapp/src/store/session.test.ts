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

import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "./session";
import type { SessionModel } from "@/types/session.model";

const session = { id: "s1", eventId: "e1", vehicleId: "v1", status: "bound" } as SessionModel;

describe("useSessionStore", () => {
  beforeEach(() => useSessionStore.getState().clear());

  it("starts with no team token and no session", () => {
    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().session).toBeNull();
  });

  it("holds the team token and session after joining", () => {
    useSessionStore.getState().setJoined("team-tok", session);

    expect(useSessionStore.getState().token).toBe("team-tok");
    expect(useSessionStore.getState().session?.id).toBe("s1");
  });

  it("can restore a token before the session has been fetched", () => {
    useSessionStore.getState().setToken("restored");

    expect(useSessionStore.getState().token).toBe("restored");
    expect(useSessionStore.getState().session).toBeNull();
  });

  it("forgets both on clear", () => {
    useSessionStore.getState().setJoined("team-tok", session);
    useSessionStore.getState().clear();

    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().session).toBeNull();
  });
});
