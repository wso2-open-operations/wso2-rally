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

import { useCallback, useMemo } from "react";
import { useAsgardeo } from "@asgardeo/react";
import { getApiConfig } from "@config/apiConfig";
import { ASGARDEO_UNAUTHENTICATED_CODE } from "@constants/apiConstants";
import { ApiError, parseApiResponseMessage } from "@utils/ApiError";

// Module scope, not hook scope: every caller gets its own authFetch closure, so
// a per-hook flag would still let ten concurrent 401s fire ten redirects.
let signInInFlight = false;

/**
 * Only Asgardeo's "unauthenticated" code means the token was missing or expired
 * when the call ran. Network failures and real backend errors must propagate
 * untouched so the error banner and error pages still see them.
 */
const isTokenExpiredError = (error: unknown): boolean =>
  error != null &&
  typeof error === "object" &&
  "code" in error &&
  (error as { code: string }).code === ASGARDEO_UNAUTHENTICATED_CODE;

// 502/503/504 come from the gateway in front of the backend, so their bodies
// are infra text — an HTML error page, or a reason phrase like "upstream
// timeout" — never a sentence fit for an organizer. Substituting here, the one
// place every call passes through, keeps the copy consistent everywhere.
const GATEWAY_MESSAGES: Record<number, string> = {
  502: "The service is temporarily unavailable. Please try again in a few moments.",
  503: "The service is temporarily unavailable. Please try again in a few moments.",
  504: "The request timed out. Please try again in a few moments.",
};

/** Bodies that must keep the browser's own Content-Type (and its boundary). */
const hasSelfDescribingContentType = (body: BodyInit): boolean =>
  body instanceof FormData ||
  body instanceof Blob ||
  body instanceof ArrayBuffer ||
  (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) ||
  (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) ||
  ArrayBuffer.isView(body);

const buildRequestHeaders = (
  options: RequestInit | undefined,
  token: string,
): Headers => {
  const headers = new Headers(options?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("x-user-id-token", token);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const method = options?.method?.toUpperCase() || "GET";
  const body = options?.body;
  if (["POST", "PUT", "PATCH"].includes(method) && body) {
    if (!hasSelfDescribingContentType(body) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  return headers;
};

export interface AuthApiClient {
  /**
   * Fetches a backend path with organizer credentials attached.
   *
   * `path` is relative to `RALLY_BACKEND_BASE_URL`. Any non-2xx is raised as an
   * `ApiError` carrying the backend's `{"message": …}`, so callers never have to
   * check `response.ok` themselves.
   */
  authFetch: (path: string, options?: RequestInit) => Promise<Response>;
  /** `authFetch` plus JSON parsing. Resolves undefined for an empty body. */
  authJson: <T>(path: string, options?: RequestInit) => Promise<T>;
}

/**
 * Builds the authenticated backend client every query hook uses.
 *
 * @returns {AuthApiClient} The `authFetch` / `authJson` pair.
 */
export function useAuthApiClient(): AuthApiClient {
  const { getIdToken, signIn } = useAsgardeo();

  // Redirecting is a navigation, so a successful sign-in resolves a promise
  // that never settles: callers must not fall through to an error page while
  // the browser is leaving.
  //
  // A *failed* signIn() is the opposite case. No navigation is coming, so
  // hanging would strand the caller with no page and no error — the rejection
  // has to propagate instead.
  const redirectToSignIn = useCallback((): Promise<Response> => {
    if (signInInFlight) {
      return new Promise<Response>(() => {});
    }

    signInInFlight = true;

    return Promise.resolve(signIn()).then(
      // Navigation is under way; never settle.
      () => new Promise<Response>(() => {}),
      (error: unknown) => {
        // Reset so a later attempt can retry the redirect.
        signInInFlight = false;
        throw error;
      },
    );
  }, [signIn]);

  const attemptFetch = useCallback(
    async (path: string, options?: RequestInit): Promise<Response> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Unable to retrieve ID token");
      }

      return fetch(`${getApiConfig().backendBaseUrl}${path}`, {
        ...options,
        headers: buildRequestHeaders(options, token),
      });
    },
    [getIdToken],
  );

  const raiseForStatus = useCallback(async (response: Response): Promise<Response> => {
    if (response.ok) {
      return response;
    }

    const gatewayMessage = GATEWAY_MESSAGES[response.status];
    if (gatewayMessage) {
      throw new ApiError(response.status, response.statusText, gatewayMessage);
    }

    // Read as text first: an error body is not guaranteed to be JSON, and a
    // failed parse must not mask the status the caller needs to branch on.
    const body = await response.text().catch(() => "");
    throw new ApiError(
      response.status,
      response.statusText,
      parseApiResponseMessage(body, response.status, response.statusText),
    );
  }, []);

  const authFetch = useCallback(
    async (path: string, options?: RequestInit): Promise<Response> => {
      try {
        return await raiseForStatus(await attemptFetch(path, options));
      } catch (error) {
        if (!isTokenExpiredError(error)) {
          throw error;
        }

        // A concurrent caller or the provider's periodic refresh may have
        // re-minted the token, so retry once before giving up on the session.
        try {
          return await raiseForStatus(await attemptFetch(path, options));
        } catch (retryError) {
          if (!isTokenExpiredError(retryError)) {
            throw retryError;
          }

          return redirectToSignIn();
        }
      }
    },
    [attemptFetch, raiseForStatus, redirectToSignIn],
  );

  const authJson = useCallback(
    async <T,>(path: string, options?: RequestInit): Promise<T> => {
      const response = await authFetch(path, options);
      const body = await response.text();

      return (body ? JSON.parse(body) : undefined) as T;
    },
    [authFetch],
  );

  return useMemo(() => ({ authFetch, authJson }), [authFetch, authJson]);
}
