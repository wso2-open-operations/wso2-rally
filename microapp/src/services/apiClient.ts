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

import axios, { AxiosError } from "axios";
import { BACKEND_URL } from "@config/endpoints";
import { teamTokenStorage } from "@services/teamToken";
import { useSessionStore } from "@store/session";

/**
 * A failed call, carrying the sentence the backend chose for it.
 *
 * Every non-2xx body is exactly `{"message": "<human sentence>"}`, so screens
 * show `message` as-is. `status` is 0 when the backend could not be reached at
 * all — on a rural stretch, the commonest failure there is.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const UNREACHABLE = "Could not reach the rally server. Check the phone's connection and try again.";

/**
 * The one HTTP client. It carries the rally's **team token** — the only
 * credential `/sessions/me/*` accepts — in `Authorization` and nowhere else:
 * the backend reads that header only.
 *
 * A request that set its own `Authorization` keeps it. Joining does exactly
 * that, with the super app's token, because there is no team token yet.
 */
export const apiClient = axios.create({ baseURL: BACKEND_URL });

apiClient.interceptors.request.use((config) => {
  const token = useSessionStore.getState().token;
  if (token && !config.headers.has("Authorization")) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  if (config.data !== undefined && !config.headers.has("Content-Type")) {
    config.headers.set("Content-Type", "application/json");
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (!(error instanceof AxiosError)) {
      return Promise.reject(error);
    }

    const status = error.response?.status ?? 0;
    if (status === 401) {
      forgetSession();
    }

    return Promise.reject(new ApiError(status, messageOf(error)));
  },
);

/**
 * The team token was refused — expired, or the run was torn down. Forget it
 * and send the crew back to join. Never retried: a token the backend refused
 * once will be refused again, and retrying hides that from the crew.
 */
function forgetSession(): void {
  useSessionStore.getState().clear();
  window.location.hash = "#/";
  teamTokenStorage.remove().catch((error: unknown) => {
    // The in-memory token is already gone, so this phone will re-join; a stale
    // copy left in storage only costs one more refused call after a restart.
    console.error("Could not delete the stored team token", error);
  });
}

function messageOf(error: AxiosError): string {
  if (!error.response) {
    return UNREACHABLE;
  }
  const data = error.response.data as { message?: unknown } | undefined;
  if (data && typeof data.message === "string" && data.message !== "") {
    return data.message;
  }

  return `The rally server answered ${error.response.status}.`;
}
