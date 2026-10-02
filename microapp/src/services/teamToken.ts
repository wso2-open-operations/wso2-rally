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
import { secureStore } from "@utils/bridge";

/**
 * Where the team token is kept, so a phone that reboots or reloads mid-rally
 * resumes its run instead of re-joining.
 *
 * Embedded, it goes in the super app's secure store: a rally credential in
 * `localStorage` on a shared phone outlives the event. That store is shared by
 * every micro app on the phone, so the key is namespaced by this app's id
 * (`microapp.json`'s `appId`), in the characters Expo accepts.
 *
 * In a desktop browser there is no secure store, and `localStorage` is fine
 * for a developer's machine.
 */
export const TEAM_TOKEN_KEY = "wso2-motor-rally.team-token";

export const teamTokenStorage = {
  async save(token: string): Promise<void> {
    if (IS_MICROAPP) {
      await secureStore.set(TEAM_TOKEN_KEY, token);
      return;
    }
    localStorage.setItem(TEAM_TOKEN_KEY, token);
  },

  async load(): Promise<string | null> {
    if (IS_MICROAPP) {
      return secureStore.get(TEAM_TOKEN_KEY);
    }

    return localStorage.getItem(TEAM_TOKEN_KEY);
  },

  async remove(): Promise<void> {
    if (IS_MICROAPP) {
      await secureStore.remove(TEAM_TOKEN_KEY);
      return;
    }
    localStorage.removeItem(TEAM_TOKEN_KEY);
  },
};
