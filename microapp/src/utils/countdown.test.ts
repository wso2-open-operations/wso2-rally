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

import { describe, expect, it } from "vitest";
import { formatCountdown } from "./countdown";

describe("formatCountdown", () => {
  it("shows minutes and seconds inside the hour", () => {
    expect(formatCountdown(7_000)).toBe("00:07");
    expect(formatCountdown(59 * 60_000 + 59_000)).toBe("59:59");
  });

  it("adds hours, then days", () => {
    expect(formatCountdown(3_600_000)).toBe("1:00:00");
    expect(formatCountdown(26 * 3_600_000 + 5_000)).toBe("1d 2:00:05");
  });

  // 400 ms left is not zero yet: rounding down would read 00:00 for most of
  // the last second, and the crew would think the start had stalled.
  it("rounds a part second up", () => {
    expect(formatCountdown(400)).toBe("00:01");
  });

  it("never counts below zero", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5_000)).toBe("00:00");
  });
});
