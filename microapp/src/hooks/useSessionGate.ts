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

import { useEffect, useState } from "react";
import { restoreSession } from "@services/session";
import { useSessionStore } from "@store/session";

/** Where this phone stands: still looking for a stored session, joined, or not joined. */
export type SessionGate = "restoring" | "joined" | "anonymous";

/**
 * Whether this phone is in a run — after giving a stored session the chance to
 * come back.
 *
 * A reload empties the in-memory store, but the team token survives in
 * storage. Deciding from the store alone would send a crew mid-rally back to
 * the join screen, so the first answer is "restoring" until the stored token
 * has been looked for. A token already in memory needs no look.
 */
export function useSessionGate(): SessionGate {
  const token = useSessionStore((state) => state.token);
  const [checked, setChecked] = useState(() => token !== null);

  useEffect(() => {
    if (checked) return;
    let live = true;
    const done = (): void => {
      if (live) setChecked(true);
    };
    restoreSession().then(done, done);

    return () => {
      live = false;
    };
  }, [checked]);

  if (token) return "joined";

  return checked ? "anonymous" : "restoring";
}
