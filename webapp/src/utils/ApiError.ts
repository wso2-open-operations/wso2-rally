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

/**
 * Error thrown by API hooks when the backend returns a non-OK response.
 * Carries the HTTP status so callers can branch on it (e.g. render a 404 page
 * instead of a banner).
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;

  constructor(status: number, statusText: string, message?: string) {
    super(message ?? `${status} ${statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
  }
}

export function isBadRequestError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** A 409 is how the backend reports a rule violation, e.g. republishing a completed event. */
export function isConflictError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/**
 * Extracts the human-readable message the backend sent in `{"message": …}`.
 *
 * Returns undefined when all we have is the status line, so callers show their
 * own copy rather than "500 Internal Server Error".
 *
 * @param {unknown} error - The caught error.
 * @returns {string | undefined} The backend's message, if it sent one.
 */
export function getApiErrorMessage(error: unknown): string | undefined {
  if (error instanceof ApiError) {
    const defaultMsg = `${error.status} ${error.statusText}`;
    return error.message !== defaultMsg ? error.message : undefined;
  }

  return undefined;
}

/**
 * Pulls a clean message out of an error response body.
 *
 * Every non-2xx from this backend is `{"message": "<human sentence>"}`, but a
 * gateway in front of it may answer with HTML, so the parse is defensive.
 *
 * @param {string} text - Raw response body.
 * @param {number} status - HTTP status code.
 * @param {string} statusText - HTTP status text.
 * @returns {string} A message fit to show a user.
 */
export function parseApiResponseMessage(
  text: string,
  status: number,
  statusText: string,
): string {
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "message" in parsed &&
        typeof (parsed as { message: unknown }).message === "string" &&
        (parsed as { message: string }).message.trim()
      ) {
        return (parsed as { message: string }).message.trim();
      }
    } catch {
      // Not JSON — fall through to the status line.
    }
  }

  return statusText?.trim() || `HTTP ${status}`;
}
