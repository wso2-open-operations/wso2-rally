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

import { mutationOptions, queryOptions } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  SESSIONS_ALERTS,
  SESSIONS_FINISH,
  SESSIONS_JOIN,
  SESSIONS_LOCATION,
  SESSIONS_ME,
  SESSIONS_VOUCHERS,
  SUBMIT,
} from "@config/endpoints";
import { apiClient } from "@services/apiClient";
import { getSuperAppToken } from "@services/auth";
import { teamTokenStorage } from "@services/teamToken";
import { useSessionStore } from "@store/session";
import type {
  AlertDTO,
  CircleDTO,
  CrewAlertRequestDTO,
  DeviceDTO,
  JoinRequestDTO,
  JoinResponseDTO,
  LocationRequestDTO,
  PingResponseDTO,
  SessionDTO,
  SessionStateDTO,
  SubmitResultDTO,
  VoucherDTO,
  WaypointDTO,
} from "@/types/session.dto";
import type {
  Circle,
  CrewAlert,
  CrewAlertInput,
  Device,
  Fix,
  JoinResult,
  PingResult,
  SessionModel,
  SessionState,
  SubmitResult,
  Voucher,
  Waypoint,
} from "@/types/session.model";

/**
 * The rally's in-car API: joining a vehicle and everything a joined phone does.
 *
 * Two tokens meet here. Joining is the one call that carries the **super
 * app's** token — it is how the backend learns who this crew member is — and
 * it answers with the rally's **team token**, which every later call carries.
 */

// ── mappers: wire → model ─────────────────────────────────────────────────────

const toDate = (value: string): Date => dayjs(value).toDate();
const toDateOrNull = (value: string | null): Date | null => (value ? toDate(value) : null);
/** The backend sends "" for "none" on a few string fields. */
const toIdOrNull = (value: string | null | undefined): string | null => (value ? value : null);

export const toSession = (dto: SessionDTO): SessionModel => ({
  id: dto.id,
  eventId: dto.eventId,
  vehicleId: dto.vehicleId,
  status: dto.status,
  currentWaypointId: toIdOrNull(dto.currentWaypointId),
  totalScore: dto.totalScore,
  boundAt: toDateOrNull(dto.boundAt),
  startedAt: toDateOrNull(dto.startedAt),
  finishedAt: toDateOrNull(dto.finishedAt),
  lastLat: dto.lastLat,
  lastLng: dto.lastLng,
});

const toCircle = (dto: CircleDTO): Circle => ({ ...dto });

const toWaypoint = (dto: WaypointDTO): Waypoint => ({
  id: dto.id,
  order: dto.order,
  circle: toCircle(dto.circle),
  taskIds: dto.taskIds ?? [],
});

export const toDevice = (dto: DeviceDTO): Device => ({
  id: dto.id,
  crewMemberId: dto.crewMemberId,
  crewMemberName: dto.crewMemberName,
  joinedAt: toDate(dto.joinedAt),
  lastSeenAt: toDateOrNull(dto.lastSeenAt),
  sharing: dto.sharing,
});

export const toSessionState = (dto: SessionStateDTO): SessionState => ({
  session: toSession(dto.session),
  vehicleCode: dto.vehicleCode,
  teamName: dto.teamName,
  eventStatus: dto.eventStatus,
  startTime: dto.startTime,
  startsAt: toDateOrNull(dto.startsAt),
  cipher: dto.cipher ? dto.cipher : null,
  startCircle: toCircle(dto.startCircle),
  finishCircle: toCircle(dto.finishCircle),
  waypoints: (dto.waypoints ?? []).map(toWaypoint),
  nextWaypointId: toIdOrNull(dto.nextWaypointId),
  crew: (dto.crew ?? []).map(toDevice),
  you: toDevice(dto.you),
  sharingCount: dto.sharingCount,
  coverageLost: dto.coverageLost,
});

export const toPingResult = (dto: PingResponseDTO): PingResult => ({
  unlockedTaskIds: dto.unlockedTaskIds ?? [],
  currentWaypointId: toIdOrNull(dto.currentWaypointId),
  arrived: dto.arrived,
  events: (dto.events ?? []).map((event) => ({
    type: event.type,
    waypointId: toIdOrNull(event.waypointId),
    taskId: toIdOrNull(event.taskId),
  })),
});

const toCrewAlert = (dto: AlertDTO): CrewAlert => ({
  id: dto.id,
  type: dto.type,
  note: dto.note,
  raisedAt: toDate(dto.raisedAt),
});

// ── calls ─────────────────────────────────────────────────────────────────────

/**
 * Puts this phone into its vehicle's run.
 *
 * The first crew member to join creates the session; the rest attach to it,
 * each with its own device row and its own team token. Re-joining is not an
 * error — a rebooted phone lands back on its own row.
 *
 * The team token is persisted before it is put in the store, so a crash
 * between the two cannot leave a phone holding a token it will forget.
 */
export async function join(vehicleId: string): Promise<JoinResult> {
  const superAppToken = await getSuperAppToken();
  const body: JoinRequestDTO = { vehicleId };
  const { data } = await apiClient.post<JoinResponseDTO>(SESSIONS_JOIN, body, {
    headers: { Authorization: `Bearer ${superAppToken}` },
  });

  const session = toSession(data.session);
  await teamTokenStorage.save(data.teamToken);
  useSessionStore.getState().setJoined(data.teamToken, session);

  return { token: data.teamToken, session, device: toDevice(data.device), crew: (data.crew ?? []).map(toDevice) };
}

/** Everything the current screen needs: the run, the course, the crew, the start. */
export async function getState(): Promise<SessionState> {
  const { data } = await apiClient.get<SessionStateDTO>(SESSIONS_ME);
  const state = toSessionState(data);
  useSessionStore.getState().setSession(state.session);

  return state;
}

/**
 * Reports a position and returns what it unlocked.
 *
 * `takenAt` goes to the backend as `ts` when present. A fix from the super
 * app's background buffer is minutes old by the time it is sent; judged by
 * arrival time, a replay of an ordinary drive reads as a string of teleports
 * and is discarded. A live fix leaves it out, and the server uses its clock.
 */
export async function ping(fix: Fix): Promise<PingResult> {
  const body: LocationRequestDTO = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy };
  if (fix.takenAt) {
    body.ts = fix.takenAt.toISOString();
  }
  const { data } = await apiClient.post<PingResponseDTO>(SESSIONS_LOCATION, body);

  return toPingResult(data);
}

/**
 * Submits one attempt at a task. The payload's shape belongs to the task's
 * type and is passed through untouched — the backend validates and scores it
 * against the task's config; the phone never decides correctness.
 */
export async function submit(taskId: string, payload: unknown): Promise<SubmitResult> {
  const { data } = await apiClient.post<SubmitResultDTO>(SUBMIT(taskId), payload);

  return { correct: data.correct, awardedPoints: data.awardedPoints, detail: data.detail };
}

/** Ends the run by hand. Arriving inside the finish geofence ends it on its own. */
export async function finish(): Promise<SessionModel> {
  const { data } = await apiClient.post<SessionDTO>(SESSIONS_FINISH);

  return toSession(data);
}

export async function getVouchers(): Promise<Voucher> {
  const { data } = await apiClient.get<VoucherDTO>(SESSIONS_VOUCHERS);

  return { entryCode: data.entryCode, lockerId: data.lockerId, lunchPasses: data.lunchPasses };
}

/** Reports a vehicle problem. It reaches the organizer's live monitor as an alert. */
export async function raiseAlert(input: CrewAlertInput): Promise<CrewAlert> {
  const body: CrewAlertRequestDTO = {
    type: input.type,
    note: input.note,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  };
  const { data } = await apiClient.post<AlertDTO>(SESSIONS_ALERTS, body);

  return toCrewAlert(data);
}

// ── TanStack Query options ────────────────────────────────────────────────────

/** Query keys, kept together so invalidation cannot drift from the queries. */
export const sessionKeys = {
  all: ["session"] as const,
  state: () => [...sessionKeys.all, "state"] as const,
  vouchers: () => [...sessionKeys.all, "vouchers"] as const,
};

export const session = {
  state: () => queryOptions({ queryKey: sessionKeys.state(), queryFn: getState }),
  vouchers: () => queryOptions({ queryKey: sessionKeys.vouchers(), queryFn: getVouchers }),
  join: () => mutationOptions({ mutationFn: (vehicleId: string) => join(vehicleId) }),
  submit: () =>
    mutationOptions({
      mutationFn: ({ taskId, payload }: { taskId: string; payload: unknown }) => submit(taskId, payload),
    }),
  finish: () => mutationOptions({ mutationFn: finish }),
  raiseAlert: () => mutationOptions({ mutationFn: raiseAlert }),
};
