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

import { create } from "zustand";
import type { SessionModel } from "@/types/session.model";

/**
 * Who this phone is in the rally: the team token every `/sessions/me/*` call
 * carries, and the session it was minted for.
 *
 * In-memory only. Persistence is `services/teamToken.ts`, which is async —
 * the super app's secure store answers over the bridge — and keeping it out of
 * the store means the 401 handler can clear the token synchronously.
 */
interface SessionStore {
  token: string | null;
  session: SessionModel | null;
  setJoined: (token: string, session: SessionModel) => void;
  /** A token restored from storage at startup, before the session has been fetched. */
  setToken: (token: string) => void;
  setSession: (session: SessionModel) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  token: null,
  session: null,
  setJoined: (token, session) => set({ token, session }),
  setToken: (token) => set({ token }),
  setSession: (session) => set({ session }),
  clear: () => set({ token: null, session: null }),
}));
