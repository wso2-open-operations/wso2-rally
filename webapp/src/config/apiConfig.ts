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

import "@config/portalConfig";

export interface ApiConfig {
  /** Backend REST root, never with a trailing slash. */
  backendBaseUrl: string;
}

/** Hosts where plain http carries no network to observe it. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Rejects a base URL that is unsafe to send an organizer's id token to.
 *
 * This value becomes the `fetch` target for every authenticated call, so a
 * deployment typo is a credential leak rather than a broken page: plain `http`
 * to anything but loopback puts the token on the wire in cleartext. Credentials,
 * a query string or a fragment mean the value is not a bare origin, and
 * appending a path to it would produce a URL nobody intended.
 *
 * @param {string} raw - The configured value.
 * @returns {URL} The parsed URL, once it is known to be safe.
 */
function parseBackendBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `Api Config Error: RALLY_BACKEND_BASE_URL must be an absolute URL, got "${raw}"`,
    );
  }

  if (url.protocol !== "https:" && !LOOPBACK_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      "Api Config Error: RALLY_BACKEND_BASE_URL must use https outside loopback; " +
        `an organizer token would otherwise travel in cleartext, got "${raw}"`,
    );
  }
  if (url.username || url.password) {
    throw new Error(
      "Api Config Error: RALLY_BACKEND_BASE_URL must not carry credentials",
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      "Api Config Error: RALLY_BACKEND_BASE_URL must not carry a query string or fragment",
    );
  }

  return url;
}

/**
 * Reads the backend base URL from the runtime config.
 *
 * Throws rather than defaulting to a guess: a web app pointed at the wrong
 * backend fails in ways that look like backend bugs.
 *
 * @returns {ApiConfig} The resolved API configuration.
 */
export function getApiConfig(): ApiConfig {
  const backendBaseUrl = window.config?.RALLY_BACKEND_BASE_URL;
  if (!backendBaseUrl) {
    throw new Error(
      "Api Config Error: Missing required configuration: RALLY_BACKEND_BASE_URL",
    );
  }
  parseBackendBaseUrl(backendBaseUrl);

  return { backendBaseUrl: backendBaseUrl.replace(/\/+$/, "") };
}

/**
 * Derives the `/ws` endpoint from the backend base URL, so a deployment only
 * ever configures one host.
 *
 * @returns {string} The WebSocket URL for live event and session topics.
 */
export function getWebSocketUrl(): string {
  const { backendBaseUrl } = getApiConfig();

  return `${backendBaseUrl.replace(/^http/, "ws")}/ws`;
}
