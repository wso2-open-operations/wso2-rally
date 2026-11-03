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

import type { PingResult } from "@/types/session.model";

/**
 * Something the backend noticed that moves the crew to another screen. It
 * reaches a phone two ways — on the session socket, which every phone in the
 * car hears, and in the answer to the phone's own ping — and both read the
 * same through here.
 */
export type SessionEvent =
  | { type: "task_unlocked"; taskIds: string[] }
  | { type: "rest_lock"; taskId: string }
  | { type: "trivia"; taskId: string }
  | { type: "arrival" };

const ROUTE = "/route";

/**
 * Where an event takes the crew from `pathname`, or null to stay put.
 *
 * Arrival and a rest stop take the car from anywhere: the run is over, or the
 * car must stop. A timed question opens at once because its clock is already
 * running. A plain unlock opens the task only from the route screen — a crew
 * half-way through one task is not pulled into the next; the route screen
 * lists it for them when they get back.
 */
export function routeFor(event: SessionEvent, pathname: string): string | null {
  let target: string | null;
  switch (event.type) {
    case "arrival":
      target = "/arrival";
      break;
    case "rest_lock":
      target = "/rest";
      break;
    case "trivia":
      target = `/task/${encodeURIComponent(event.taskId)}`;
      break;
    case "task_unlocked":
      target = pathname === ROUTE && event.taskIds.length > 0 ? `/task/${encodeURIComponent(event.taskIds[0])}` : null;
      break;
  }

  return target === pathname ? null : target;
}

/** A ping's answer, as the events the socket would carry for it. */
export function eventsOfPing(result: PingResult): SessionEvent[] {
  const events: SessionEvent[] = [];
  if (result.unlockedTaskIds.length > 0) {
    events.push({ type: "task_unlocked", taskIds: result.unlockedTaskIds });
  }
  for (const event of result.events) {
    if ((event.type === "rest_lock" || event.type === "trivia") && event.taskId) {
      events.push({ type: event.type, taskId: event.taskId });
    } else if (event.type === "arrival") {
      events.push({ type: "arrival" });
    }
  }

  return events;
}
