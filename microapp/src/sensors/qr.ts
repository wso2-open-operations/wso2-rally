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

import { BridgeError, requestQr } from "@utils/bridge";

/**
 * Scans a QR code with the super app's native scanner.
 *
 * There is no web camera path: the plan rules out `getUserMedia`,
 * `BarcodeDetector` and `@zxing/browser` for an app loaded from `file://`. So a
 * host without the scanner — or a desktop browser — rejects here, and every
 * caller must offer manual entry. It is the only fallback, not a nicety.
 *
 * Closing the scanner sends nothing back, so this also rejects when the
 * crew gives up, after the bridge's human-length timeout.
 */
export async function scanQr(): Promise<string> {
  if (typeof window.nativebridge?.requestQr !== "function") {
    throw new BridgeError("requestQr", "QR scanning needs the super app's scanner. Enter the code by hand instead.");
  }

  return requestQr();
}
