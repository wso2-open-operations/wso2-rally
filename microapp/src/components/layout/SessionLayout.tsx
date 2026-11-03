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

import { useQueryClient } from "@tanstack/react-query";
import type { JSX } from "react";
import { Outlet } from "react-router-dom";
import { SessionSocketContext } from "@context/SessionSocketContext";
import { useSessionSocket } from "@hooks/useSessionSocket";
import { sessionKeys } from "@services/session";
import { useSessionStore } from "@store/session";

/**
 * The frame around every joined screen (B2–B10): it holds the phone's one
 * session socket and shares it with whichever screen is showing.
 *
 * The socket waits for the run's id, which a restored phone learns from its
 * first GET /sessions/me. A reconnect refetches everything the session owns,
 * because the hub keeps no history and anything sent during the drop is gone.
 */
export default function SessionLayout(): JSX.Element {
  const sessionId = useSessionStore((state) => state.session?.id ?? null);
  const queryClient = useQueryClient();
  const socket = useSessionSocket(sessionId, {
    onReconnect: () => void queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
  });

  return (
    <SessionSocketContext value={socket}>
      <Outlet />
    </SessionSocketContext>
  );
}
