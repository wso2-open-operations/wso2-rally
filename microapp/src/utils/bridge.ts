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

/**
 * The WSO2 Open Super App's native bridge, promise-wrapped.
 *
 * The super app injects `window.nativebridge` before this app's scripts run. A
 * request is a one-way call — `nativebridge.requestX(...)` posts to the native
 * side — and the answer comes back later as a call to a global callback,
 * `nativebridge.resolveX(data)` or `nativebridge.rejectX(error)`. This module
 * turns each of those pairs into a promise.
 *
 * Three properties of that protocol shape everything below:
 *
 * - **Some topics never answer.** There is no `rejectToken`, and closing the
 *   native QR scanner sends nothing back. Every request therefore times out,
 *   or a failure on the host side would leave the screen waiting forever.
 * - **One callback slot per topic.** Overlapping requests of the same topic
 *   would each install a resolver, the later overwriting the earlier, so one
 *   would hang and the other could receive the wrong answer. Requests of a
 *   topic are therefore sent one at a time.
 * - **Answers carry no request id.** If a request times out and the host
 *   answers it late, that answer lands on whichever request of the topic is
 *   waiting next. Timeouts are sized so this needs a host that is badly stuck,
 *   but it is a limit of the protocol that this module cannot fully remove.
 *
 * Contract as implemented by the host's `frontend/app/micro-app.tsx` and
 * `frontend/utils/bridge.ts`.
 */

/** The injected object. Only the members this app uses are typed. */
type NativeBridge = Record<string, ((...args: never[]) => unknown) | undefined>;

declare global {
  interface Window {
    nativebridge?: NativeBridge;
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

/** A bridge call that failed, timed out, or had no super app to talk to. */
export class BridgeError extends Error {
  readonly topic: string;

  constructor(topic: string, message: string) {
    super(message);
    this.name = "BridgeError";
    this.topic = topic;
  }
}

/** Long enough for a token exchange or a secure-store read on a slow phone. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * For calls a person answers — a scan, a confirmation dialog. Two minutes is
 * longer than anyone takes to aim at a QR code, and short enough that a crew
 * who closed the scanner gets the manual-entry fallback without reloading.
 */
export const HUMAN_TIMEOUT_MS = 120_000;

/** Whether the super app has injected its bridge — i.e. this is running embedded. */
export const isEmbedded = (): boolean => typeof window.nativebridge !== "undefined";

/**
 * The last in-flight request of each topic, keyed by the callback the host
 * answers on. Absent while the topic is idle.
 */
const inFlight = new Map<string, Promise<void>>();

interface Call {
  request: string;
  resolve: string;
  /** Null for topics the host never rejects. */
  reject: string | null;
  args: unknown[];
  timeoutMs: number;
}

/**
 * Sends one request and waits for its answer, after any earlier request of the
 * same topic has settled. An idle topic sends immediately.
 */
function call<T>(spec: Call): Promise<T> {
  const ahead = inFlight.get(spec.resolve);
  const run = (): Promise<T> => send<T>(spec);
  const result = ahead ? ahead.then(run) : run();

  const done = result.then(
    () => undefined,
    () => undefined,
  );
  inFlight.set(spec.resolve, done);
  void done.then(() => {
    if (inFlight.get(spec.resolve) === done) inFlight.delete(spec.resolve);
  });

  return result;
}

function send<T>({ request, resolve, reject, args, timeoutMs }: Call): Promise<T> {
  return new Promise<T>((onResolve, onReject) => {
    const bridge = window.nativebridge;
    const requestFn = bridge?.[request];
    if (!bridge || typeof requestFn !== "function") {
      onReject(new BridgeError(request, `${request} is not available: not running inside the super app`));
      return;
    }

    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome();
    };
    const timer = setTimeout(
      () => settle(() => onReject(new BridgeError(request, `${request} timed out after ${timeoutMs} ms`))),
      timeoutMs,
    );

    // Installed before the request goes out: a host that answers synchronously
    // would otherwise call a callback that does not exist yet.
    bridge[resolve] = ((value: unknown) => settle(() => onResolve(value as T))) as never;
    if (reject) {
      bridge[reject] = ((error: unknown) =>
        settle(() => onReject(new BridgeError(request, describe(error, `${request} failed`))))) as never;
    }

    try {
      (requestFn as (...a: unknown[]) => unknown)(...args);
    } catch (error) {
      settle(() => onReject(new BridgeError(request, describe(error, `${request} threw`))));
    }
  });
}

function describe(error: unknown, fallback: string): string {
  if (typeof error === "string" && error) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * The super app's Asgardeo access token, minted for this app's `clientId`.
 *
 * Used once, to join: `POST /sessions/join` trades it for the rally's team
 * token. The host has no reject callback for this topic, so a failed exchange
 * shows up only as the timeout.
 */
export async function requestToken(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const token = await call<string>({
    request: "requestToken",
    resolve: "resolveToken",
    reject: null,
    args: [],
    timeoutMs,
  });
  if (typeof token !== "string" || token === "") {
    throw new BridgeError("requestToken", "the super app returned an empty token");
  }

  return token;
}

/**
 * Opens the super app's native QR scanner and resolves with what it read.
 *
 * Closing the scanner sends nothing back, so the promise rejects on the timeout
 * instead. Every caller must offer manual entry: it is the only fallback.
 */
export async function requestQr(timeoutMs = HUMAN_TIMEOUT_MS): Promise<string> {
  const text = await call<string>({
    request: "requestQr",
    resolve: "resolveQrCode",
    reject: null,
    args: [],
    timeoutMs,
  });
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed === "") {
    throw new BridgeError("requestQr", "the scanner returned nothing");
  }

  return trimmed;
}

/**
 * The super app's secure store. It is shared by every micro app on the phone,
 * so keys must be namespaced by the caller; Expo allows letters, digits, `.`,
 * `-` and `_`.
 */
export const secureStore = {
  async set(key: string, value: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    await call<void>({
      request: "requestSecureStorePersistence",
      resolve: "resolveSecureStorePersistence",
      reject: "rejectSecureStorePersistence",
      args: [key, value],
      timeoutMs,
    });
  },

  /** Resolves `null` for a key that was never written. */
  async get(key: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string | null> {
    const result = await call<{ value?: string | null } | null>({
      request: "requestSecureStoreRetrieval",
      resolve: "resolveSecureStoreRetrieval",
      reject: "rejectSecureStoreRetrieval",
      args: [key],
      timeoutMs,
    });

    return result?.value ?? null;
  },

  async remove(key: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    await call<void>({
      request: "requestSecureStoreDeletion",
      resolve: "resolveSecureStoreDeletion",
      reject: "rejectSecureStoreDeletion",
      args: [key],
      timeoutMs,
    });
  },
};

/** A native alert. The host sends nothing back, so there is nothing to await. */
export function alert(title: string, message: string, buttonText = "OK"): void {
  const requestAlert = window.nativebridge?.requestAlert;
  if (typeof requestAlert !== "function") {
    throw new BridgeError("requestAlert", "requestAlert is not available: not running inside the super app");
  }
  (requestAlert as (...a: unknown[]) => unknown)(title, message, buttonText);
}

/** A native confirmation dialog. True only when the crew pressed confirm. */
export async function confirm(
  title: string,
  message: string,
  confirmButtonText: string,
  cancelButtonText: string,
  timeoutMs = HUMAN_TIMEOUT_MS,
): Promise<boolean> {
  const action = await call<string>({
    request: "requestConfirmAlert",
    resolve: "resolveConfirmAlert",
    reject: null,
    args: [title, message, confirmButtonText, cancelButtonText],
    timeoutMs,
  });

  return action === "confirm";
}

/** How the super app should present a URL. */
export interface OpenUrlConfig {
  url: string;
  presentationStyle?: string;
  dismissButtonStyle?: string;
}

/** Opens a URL outside the WebView — the Google Maps hand-off on the route screen. */
export async function openUrl(config: OpenUrlConfig, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  await call<void>({
    request: "requestOpenUrl",
    resolve: "resolveOpenUrl",
    reject: "rejectOpenUrl",
    args: [config],
    timeoutMs,
  });
}

/**
 * Posts a topic the injected object has no request function for. The reference
 * micro app sends these straight to the WebView, and so does this one.
 */
function post(topic: string, data?: unknown): void {
  const webView = window.ReactNativeWebView;
  if (!webView) {
    throw new BridgeError(topic, `${topic} is not available: not running inside the super app`);
  }
  webView.postMessage(JSON.stringify(data === undefined ? { topic } : { topic, data }));
}

/** Closes this micro app and returns to the super app. */
export function closeWebView(): void {
  post("close_webview");
}

export type NativeLogLevel = "debug" | "info" | "warn" | "error";

/** Writes to the super app's log, which is the only log reachable from a phone in the field. */
export function log(message: string, data?: unknown, level: NativeLogLevel = "info"): void {
  post("native_log", { message, data, level });
}

/** Options for the super app's `location` topic. */
export interface LocationRequestOptions {
  accuracy?: "high" | "balanced";
  distanceIntervalM?: number;
  timeIntervalMs?: number;
  /** Keep reporting while the super app is backgrounded; fixes are buffered and flushed on resume. */
  background?: boolean;
}

/** One fix from the `location` topic. */
export interface LocationFix {
  lat: number;
  lng: number;
  accuracy: number;
  /** ISO 8601, when the fix was taken — not when it was delivered. */
  ts: string;
  /** True on fixes recorded while backgrounded and flushed on resume. */
  buffered?: boolean;
}

/** Why the host refused or lost the stream. */
export type LocationRejectReason =
  "permission_denied" | "background_permission_denied" | "services_disabled" | "not_declared" | "unavailable";

/**
 * Opens the super app's location stream. Unlike every other topic this is a
 * subscription: `onFix` fires until the returned function is called.
 *
 * Call the returned function. A stream left open drains the battery of a phone
 * whose owner has already moved on.
 *
 * The host keeps one stream per micro app and starting again replaces it, so
 * this is the single owner of that stream — `sensors/position.ts` multiplexes it.
 */
export function subscribeLocation(
  options: LocationRequestOptions,
  onFix: (fix: LocationFix) => void,
  onError: (reason: LocationRejectReason | string) => void,
): () => void {
  const bridge = window.nativebridge;
  const start = bridge?.requestLocationUpdates;
  if (!bridge || typeof start !== "function") {
    onError("unavailable");
    return () => {};
  }

  let active = true;
  bridge.resolveLocationUpdate = ((fix: LocationFix) => {
    if (active) onFix(fix);
  }) as never;
  bridge.rejectLocationUpdates = ((reason: unknown) => {
    if (active) onError(describe(reason, "unavailable"));
  }) as never;

  (start as (o: LocationRequestOptions) => unknown)(options);

  return () => {
    if (!active) return;
    active = false;
    const stop = window.nativebridge?.requestStopLocationUpdates;
    if (typeof stop === "function") {
      (stop as () => unknown)();
    }
  };
}
