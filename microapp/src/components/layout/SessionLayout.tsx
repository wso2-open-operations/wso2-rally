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

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type JSX } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { LocationReporterContext } from "@context/LocationReporterContext";
import { SessionSocketContext } from "@context/SessionSocketContext";
import { useLocationReporter } from "@hooks/useLocationReporter";
import { useSessionSocket } from "@hooks/useSessionSocket";
import { session, sessionKeys } from "@services/session";
import { useSessionStore } from "@store/session";
import { eventsOfPing, routeFor, type SessionEvent } from "@utils/sessionEvents";
import type { PingResult } from "@/types/session.model";
import type { SessionFrame } from "@/types/socket.dto";
import CoverageBanner from "./CoverageBanner";
import SessionAppBar from "./SessionAppBar";

/**
 * The frame around every joined screen (B2–B10). It holds the two things a
 * phone keeps for the whole run, whatever screen is showing:
 *
 * - **the session socket**, which waits for the run's id (a restored phone
 *   learns it from its first GET /sessions/me) and refetches everything the
 *   session owns on a reconnect, because the hub keeps no history;
 * - **the location reporter**, which starts on B4 — or by itself for a car
 *   already under way — and keeps reporting into a task and back, so a crew
 *   answering a question does not take the car off the map.
 *
 * Both deliver the same events — the socket to every phone in the car, a ping's
 * answer to the phone that sent it — and both go through `routeFor`, so the
 * phone that crossed a geofence and its teammates' phones move together.
 */
export default function SessionLayout(): JSX.Element {
  const sessionId = useSessionStore((state) => state.session?.id ?? null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const run = useQuery(session.state());

  // The handlers outlive renders (the socket and the reporter hold them), so
  // they read the current screen from a ref rather than a stale closure.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: sessionKeys.all });

  const follow = (event: SessionEvent): void => {
    const target = routeFor(event, pathRef.current);
    if (target) {
      // Set now, not on the next render: the same event is usually already on
      // its way from the other channel, and must find the crew there.
      pathRef.current = target;
      navigate(target);
    }
  };

  const onFrame = (frame: SessionFrame): void => {
    switch (frame.type) {
      case "task_unlocked":
        refresh();
        follow({ type: "task_unlocked", taskIds: frame.taskIds });
        break;
      case "rest_lock":
      case "trivia":
        follow({ type: frame.type, taskId: frame.taskId });
        break;
      case "arrival":
        refresh();
        follow({ type: "arrival" });
        break;
      case "task_completed":
        refresh();
        break;
    }
  };

  const onResult = (result: PingResult): void => {
    const events = eventsOfPing(result);
    if (events.length === 0) return;
    refresh();
    events.forEach(follow);
  };

  const socket = useSessionSocket(sessionId, { onFrame, onReconnect: refresh });
  const status = run.data?.session.status;
  const reporter = useLocationReporter({
    autoStart: status === "active",
    runOver: status === "finished" || socket.arrived,
    onResult,
  });

  return (
    <SessionSocketContext value={socket}>
      <LocationReporterContext value={reporter}>
        <SessionAppBar />
        <CoverageBanner />
        <Outlet />
      </LocationReporterContext>
    </SessionSocketContext>
  );
}
