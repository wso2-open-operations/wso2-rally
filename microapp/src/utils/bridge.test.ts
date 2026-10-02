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
import {
  BridgeError,
  closeWebView,
  confirm,
  isEmbedded,
  log,
  requestQr,
  requestToken,
  secureStore,
  subscribeLocation,
} from "./bridge";

type Host = Record<string, (...args: never[]) => unknown>;

/** Installs a stand-in for the object the super app injects. */
const host = (methods: Host): Host => {
  (window as unknown as { nativebridge: Host }).nativebridge = { ...methods };
  return (window as unknown as { nativebridge: Host }).nativebridge;
};

/** The host answers by calling a named global callback, the way `sendResponseToWeb` does. */
const answer = (method: string, data?: unknown): void => {
  (window as unknown as { nativebridge: Record<string, (d?: unknown) => void> }).nativebridge[method](data);
};

let posted: unknown[];

beforeEach(() => {
  posted = [];
  (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = {
    postMessage: (message: string) => posted.push(JSON.parse(message)),
  };
});

afterEach(() => {
  delete (window as unknown as { nativebridge?: unknown }).nativebridge;
  delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  vi.useRealTimers();
});

describe("isEmbedded", () => {
  it("is true only when the super app has injected the bridge", () => {
    expect(isEmbedded()).toBe(false);
    host({});
    expect(isEmbedded()).toBe(true);
  });
});

describe("requestToken", () => {
  it("resolves with the token the host calls back with", async () => {
    host({ requestToken: () => answer("resolveToken", "tok-from-host") });

    await expect(requestToken()).resolves.toBe("tok-from-host");
  });

  // The host defines no rejectToken: a timeout is the only way a failed token
  // exchange can ever reach the app.
  it("rejects rather than hanging when the host never answers", async () => {
    host({ requestToken: () => {} });

    await expect(requestToken(50)).rejects.toThrow(/timed out/i);
  });

  it("rejects an empty token instead of joining with nothing", async () => {
    host({ requestToken: () => answer("resolveToken", "") });

    await expect(requestToken()).rejects.toThrow(BridgeError);
  });

  it("rejects at once when there is no super app", async () => {
    await expect(requestToken()).rejects.toThrow(/not available/i);
  });

  // The resolver must be in place before the request goes out: a host that
  // answers synchronously would otherwise call a callback that does not exist.
  it("installs the callback before posting the request", async () => {
    let seenResolver: unknown;
    host({
      requestToken: () => {
        seenResolver = (window as unknown as { nativebridge: Host }).nativebridge.resolveToken;
        answer("resolveToken", "t");
      },
    });

    await requestToken();
    expect(typeof seenResolver).toBe("function");
  });
});

describe("one callback slot per topic", () => {
  // The host answers every request of a topic through the same global
  // callback. Two overlapping reads would each install a resolver, the second
  // would overwrite the first, and the first would hang or get the second's
  // value. So requests of one topic are sent one at a time.
  it("does not send a second request until the first is answered", async () => {
    const asked: string[] = [];
    host({ requestSecureStoreRetrieval: (key: never) => void asked.push(key) });

    const first = secureStore.get("a");
    const second = secureStore.get("b");
    await Promise.resolve();
    expect(asked).toEqual(["a"]);

    answer("resolveSecureStoreRetrieval", { value: "A" });
    await expect(first).resolves.toBe("A");
    await vi.waitFor(() => expect(asked).toEqual(["a", "b"]));

    answer("resolveSecureStoreRetrieval", { value: "B" });
    await expect(second).resolves.toBe("B");
  });

  it("moves on to the next request after one times out", async () => {
    const asked: string[] = [];
    host({ requestSecureStoreRetrieval: (key: never) => void asked.push(key) });

    const first = secureStore.get("a", 30);
    const second = secureStore.get("b", 1_000);
    await expect(first).rejects.toThrow(/timed out/i);
    await vi.waitFor(() => expect(asked).toEqual(["a", "b"]));

    answer("resolveSecureStoreRetrieval", { value: "B" });
    await expect(second).resolves.toBe("B");
  });
});

describe("secureStore", () => {
  it("returns null for a key that was never written", async () => {
    host({ requestSecureStoreRetrieval: () => answer("resolveSecureStoreRetrieval", { value: null }) });

    await expect(secureStore.get("missing")).resolves.toBeNull();
  });

  it("surfaces the host's error", async () => {
    host({ requestSecureStorePersistence: () => answer("rejectSecureStorePersistence", "disk full") });

    await expect(secureStore.set("k", "v")).rejects.toThrow("disk full");
  });

  it("writes and deletes through the matching topics", async () => {
    const calls: unknown[][] = [];
    host({
      requestSecureStorePersistence: (...args: never[]) => {
        calls.push(["set", ...args]);
        answer("resolveSecureStorePersistence");
      },
      requestSecureStoreDeletion: (...args: never[]) => {
        calls.push(["remove", ...args]);
        answer("resolveSecureStoreDeletion");
      },
    });

    await secureStore.set("k", "v");
    await secureStore.remove("k");
    expect(calls).toEqual([
      ["set", "k", "v"],
      ["remove", "k"],
    ]);
  });
});

describe("requestQr", () => {
  // The host answers a scan through resolveQrCode — not resolveQr.
  it("resolves with the scanned text", async () => {
    host({ requestQr: () => answer("resolveQrCode", "  CHECKPOINT-7 ") });

    await expect(requestQr()).resolves.toBe("CHECKPOINT-7");
  });

  // Closing the native scanner sends nothing back, so a human-length timeout
  // is what lets the screen fall back to manual entry.
  it("times out when the crew closes the scanner", async () => {
    host({ requestQr: () => {} });

    await expect(requestQr(40)).rejects.toThrow(/timed out/i);
  });
});

describe("confirm", () => {
  it("is true only when the crew pressed confirm", async () => {
    host({ requestConfirmAlert: () => answer("resolveConfirmAlert", "confirm") });
    await expect(confirm("Finish?", "End the run now?", "Finish", "Keep going")).resolves.toBe(true);

    host({ requestConfirmAlert: () => answer("resolveConfirmAlert", "cancel") });
    await expect(confirm("Finish?", "End the run now?", "Finish", "Keep going")).resolves.toBe(false);
  });
});

describe("fire-and-forget topics", () => {
  // These have no request function on the injected object; the reference
  // micro app posts them straight to the WebView.
  it("posts close_webview and native_log as raw messages", () => {
    host({});

    closeWebView();
    log("joined", { vehicleId: "v1" }, "info");

    expect(posted).toEqual([
      { topic: "close_webview" },
      { topic: "native_log", data: { message: "joined", data: { vehicleId: "v1" }, level: "info" } },
    ]);
  });
});

describe("subscribeLocation", () => {
  it("delivers every fix until stopped, then stops the host stream", () => {
    const requestStopLocationUpdates = vi.fn();
    const requestLocationUpdates = vi.fn();
    host({ requestLocationUpdates, requestStopLocationUpdates });
    const fixes: unknown[] = [];

    const stop = subscribeLocation({ accuracy: "high" }, (fix) => fixes.push(fix), vi.fn());
    answer("resolveLocationUpdate", { lat: 1, lng: 2, accuracy: 5, ts: "2027-02-13T09:00:00Z" });
    answer("resolveLocationUpdate", { lat: 1.1, lng: 2, accuracy: 5, ts: "2027-02-13T09:00:05Z" });
    stop();
    answer("resolveLocationUpdate", { lat: 9, lng: 9, accuracy: 5, ts: "2027-02-13T09:00:10Z" });

    expect(requestLocationUpdates).toHaveBeenCalledWith({ accuracy: "high" });
    expect(fixes).toHaveLength(2);
    expect(requestStopLocationUpdates).toHaveBeenCalledOnce();
  });

  it("hands the host's reason to the error callback", () => {
    host({ requestLocationUpdates: () => answer("rejectLocationUpdates", "not_declared") });
    const onError = vi.fn();

    subscribeLocation({}, vi.fn(), onError);

    expect(onError).toHaveBeenCalledWith("not_declared");
  });
});
