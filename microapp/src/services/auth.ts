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

import { IS_MICROAPP } from "@config/endpoints";
import { requestToken } from "@utils/bridge";

/**
 * The super app's Asgardeo token: who this crew member is.
 *
 * Used once, at join, which trades it for the rally's team token — see
 * `services/session.ts`. Every later call carries the team token instead.
 *
 * Embedded, it comes over the native bridge. In a desktop browser there is no
 * super app, so `DEV_SUPER_APP_TOKEN` from `config.js` stands in. The backend
 * reads the token's `email` claim to find the member on the vehicle's roster,
 * so whichever token is used must carry it.
 *
 * Neither path falls back to the other. `IS_MICROAPP` with no bridge is a
 * packaging fault, and a browser without a token is a setup step not yet done;
 * both are reported rather than guessed around.
 */
export async function getSuperAppToken(): Promise<string> {
  if (IS_MICROAPP) {
    return requestToken();
  }

  const devToken = window.config?.DEV_SUPER_APP_TOKEN;
  if (!devToken) {
    throw new Error(
      "Not running inside the super app, and config.js sets no DEV_SUPER_APP_TOKEN. " +
        "Set it to a token whose email is on this vehicle's roster to join from a desktop browser.",
    );
  }

  return devToken;
}
