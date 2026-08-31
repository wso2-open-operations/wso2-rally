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

import { describe, it, expect } from "vitest";
import {
  ApiError,
  getApiErrorMessage,
  isBadRequestError,
  isConflictError,
  isForbiddenError,
  isNotFoundError,
  isUnauthorizedError,
  parseApiResponseMessage,
} from "@utils/ApiError";

describe("ApiError", () => {
  it("carries the status and the backend message", () => {
    const error = new ApiError(404, "Not Found", "Event not found.");

    expect(error.status).toBe(404);
    expect(error.statusText).toBe("Not Found");
    expect(getApiErrorMessage(error)).toBe("Event not found.");
  });

  it("classifies the statuses the UI branches on", () => {
    expect(isBadRequestError(new ApiError(400, "Bad Request"))).toBe(true);
    expect(isUnauthorizedError(new ApiError(401, "Unauthorized"))).toBe(true);
    expect(isForbiddenError(new ApiError(403, "Forbidden"))).toBe(true);
    expect(isNotFoundError(new ApiError(404, "Not Found"))).toBe(true);
    expect(isConflictError(new ApiError(409, "Conflict"))).toBe(true);
    expect(isNotFoundError(new Error("boom"))).toBe(false);
  });

  // Without a specific message there is nothing worth showing a user beyond
  // the caller's own fallback copy.
  it("reports no message when only the status line is available", () => {
    expect(getApiErrorMessage(new ApiError(500, "Internal Server Error"))).toBeUndefined();
    expect(getApiErrorMessage(new Error("boom"))).toBeUndefined();
  });
});

describe("parseApiResponseMessage", () => {
  it("prefers the backend's {message} body", () => {
    expect(
      parseApiResponseMessage(
        '{"message":"Both geofences must be placed."}',
        400,
        "Bad Request",
      ),
    ).toBe("Both geofences must be placed.");
  });

  it("falls back to the status when the body is not usable", () => {
    expect(parseApiResponseMessage("<html>502</html>", 502, "Bad Gateway")).toBe(
      "Bad Gateway",
    );
    expect(parseApiResponseMessage("", 500, "")).toBe("HTTP 500");
  });
});
