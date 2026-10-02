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

import { afterEach, describe, expect, it } from "vitest";
import { scanQr } from "./qr";

afterEach(() => {
  delete (window as unknown as { nativebridge?: unknown }).nativebridge;
});

describe("scanQr", () => {
  it("returns what the super app's native scanner read", async () => {
    const bridge: Record<string, (v?: string) => void> = {};
    bridge.requestQr = () => bridge.resolveQrCode("PRX-04-HUB");
    (window as unknown as { nativebridge: unknown }).nativebridge = bridge;

    await expect(scanQr()).resolves.toBe("PRX-04-HUB");
  });

  // There is no web camera path from a file:// origin, so a desktop browser —
  // or a host without the scanner — gets pointed at manual entry.
  it("points at manual entry when there is no native scanner", async () => {
    await expect(scanQr()).rejects.toThrow(/enter the code/i);
  });
});
