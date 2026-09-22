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
 * Runtime configuration and the backend's paths.
 *
 * Read from `window.config`, which `index.html` loads from a **relative**
 * `./config.js` before the bundle. Relative because the super app extracts this
 * app's zip to an arbitrary directory and loads it over `file://`, where an
 * absolute `/config.js` resolves to the filesystem root.
 *
 * Importing this module throws when the backend URL is absent. That is
 * deliberate: a micro app that starts without one renders a working-looking
 * shell and then fails every call against `undefined/sessions/me`, which is a
 * far worse thing to debug at the start line than a blank screen with a reason.
 */

/** Shape of the object `config.js` defines. */
export interface RallyMicroAppConfig {
  BACKEND_BASE_URL?: string;
  ASGARDEO_BASE_URL?: string;
  CLIENT_ID?: string;
  SIGN_IN_REDIRECT_URL?: string;
  SIGN_OUT_REDIRECT_URL?: string;
  /** True when running inside the super app's WebView. */
  IS_MICROAPP?: boolean;
}

declare global {
  interface Window {
    config?: RallyMicroAppConfig;
  }
}

const base = window.config?.BACKEND_BASE_URL;
if (!base) {
  throw new Error("Config Error: BACKEND_BASE_URL is not defined");
}

/** Backend REST root, never with a trailing slash. */
export const BACKEND_URL = base.replace(/\/+$/, "");

/**
 * The live socket, derived from the REST root so a deployment configures one
 * host rather than two that can drift apart. `https` becomes `wss` because the
 * replacement runs on the `http` prefix.
 */
export const WS_URL = `${BACKEND_URL.replace(/^http/, "ws")}/ws`;

/**
 * Whether the super app is hosting us.
 *
 * Exactly `true`, not merely truthy: this selects the native-bridge token path
 * over a browser OIDC sign-in, and a stray `"false"` string in a hand-edited
 * config.js must not put a desktop browser on the bridge path, where nothing
 * would ever answer.
 */
export const IS_MICROAPP = window.config?.IS_MICROAPP === true;

// Participant surface. Every /sessions/me/* path takes the team token; join is
// the one that trades the super app's Asgardeo token for it.
export const SESSIONS_JOIN = "/sessions/join";
export const SESSIONS_ME = "/sessions/me";
export const SESSIONS_LOCATION = "/sessions/me/location";
export const SESSIONS_TASKS = "/sessions/me/tasks";
export const SESSIONS_ALERTS = "/sessions/me/alerts";
export const SESSIONS_FINISH = "/sessions/me/finish";
export const SESSIONS_VOUCHERS = "/sessions/me/vouchers";

/** One task definition, redacted by the backend for a crew caller. */
export const TASK = (id: string): string => `/tasks/${id}`;

/** Scores one attempt at a task. */
export const SUBMIT = (taskId: string): string => `/sessions/me/tasks/${taskId}/submit`;
