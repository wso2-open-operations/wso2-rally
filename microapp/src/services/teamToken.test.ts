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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `teamToken` reads IS_MICROAPP at import time, so each case loads a fresh copy. */
const load = async (isMicroapp: boolean) => {
  vi.resetModules();
  (window as unknown as { config: unknown }).config = {
    BACKEND_BASE_URL: "http://backend.test",
    IS_MICROAPP: isMicroapp,
  };

  return import("./teamToken");
};

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  localStorage.clear();
});

afterEach(() => {
  delete (window as unknown as { nativebridge?: unknown }).nativebridge;
});

/** A super app whose secure store is an in-memory map. */
const embed = () => {
  const bridge: Record<string, (...args: never[]) => void> = {};
  bridge.requestSecureStorePersistence = ((key: string, value: string) => {
    store.set(key, value);
    bridge.resolveSecureStorePersistence();
  }) as never;
  bridge.requestSecureStoreRetrieval = ((key: string) =>
    (bridge.resolveSecureStoreRetrieval as (v: unknown) => void)({ value: store.get(key) ?? null })) as never;
  bridge.requestSecureStoreDeletion = ((key: string) => {
    store.delete(key);
    bridge.resolveSecureStoreDeletion();
  }) as never;
  (window as unknown as { nativebridge: unknown }).nativebridge = bridge;
};

describe("teamTokenStorage, embedded", () => {
  // A rally token in localStorage on a shared phone outlives the event.
  it("keeps the token in the super app's secure store, not localStorage", async () => {
    embed();
    const { teamTokenStorage, TEAM_TOKEN_KEY } = await load(true);

    await teamTokenStorage.save("team-tok");

    expect(store.get(TEAM_TOKEN_KEY)).toBe("team-tok");
    expect(localStorage.length).toBe(0);
    await expect(teamTokenStorage.load()).resolves.toBe("team-tok");
  });

  // The secure store is shared by every micro app on the phone.
  it("namespaces the key by this app", async () => {
    const { TEAM_TOKEN_KEY } = await load(true);

    expect(TEAM_TOKEN_KEY).toMatch(/^wso2-motor-rally\./);
    expect(TEAM_TOKEN_KEY).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("removes it", async () => {
    embed();
    const { teamTokenStorage, TEAM_TOKEN_KEY } = await load(true);
    await teamTokenStorage.save("team-tok");

    await teamTokenStorage.remove();

    expect(store.has(TEAM_TOKEN_KEY)).toBe(false);
  });
});

describe("teamTokenStorage, browser development", () => {
  it("uses localStorage when not embedded", async () => {
    const { teamTokenStorage, TEAM_TOKEN_KEY } = await load(false);

    await teamTokenStorage.save("dev-tok");

    expect(localStorage.getItem(TEAM_TOKEN_KEY)).toBe("dev-tok");
    await expect(teamTokenStorage.load()).resolves.toBe("dev-tok");
    await teamTokenStorage.remove();
    await expect(teamTokenStorage.load()).resolves.toBeNull();
  });
});
