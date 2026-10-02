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

import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JoinResponseDTO, SessionDTO, SessionStateDTO } from "@/types/session.dto";

vi.hoisted(() => {
  (window as unknown as { config: unknown }).config = {
    BACKEND_BASE_URL: "http://backend.test",
    IS_MICROAPP: false,
    DEV_SUPER_APP_TOKEN: "super-app-tok",
  };
});

const { apiClient } = await import("./apiClient");
const { useSessionStore } = await import("@/store/session");
const { teamTokenStorage } = await import("./teamToken");
const sessionService = await import("./session");

const sessionDTO: SessionDTO = {
  id: "s1",
  eventId: "e1",
  vehicleId: "v1",
  status: "active",
  currentWaypointId: null,
  totalScore: 640,
  boundAt: "2027-02-13T03:00:00Z",
  startedAt: "2027-02-13T03:30:00Z",
  finishedAt: null,
  lastLat: 6.89,
  lastLng: 79.92,
};

const device = {
  id: "d1",
  crewMemberId: "c1",
  crewMemberName: "Nimal Perera",
  joinedAt: "2027-02-13T03:00:00Z",
  lastSeenAt: null,
  sharing: false,
};

let sent: InternalAxiosRequestConfig[];

/** Answers each request with the next body in `bodies`. */
const replyWith =
  (...bodies: unknown[]): AxiosAdapter =>
  async (config) => {
    sent.push(config);
    return { data: bodies.shift(), status: 200, statusText: "OK", headers: {}, config };
  };

const bodyOf = (config: InternalAxiosRequestConfig): unknown => JSON.parse(config.data as string);

beforeEach(async () => {
  sent = [];
  useSessionStore.getState().clear();
  await teamTokenStorage.remove();
});

describe("join", () => {
  const joinResponse: JoinResponseDTO = { teamToken: "team-tok", session: sessionDTO, device, crew: [device] };

  // There is no team token yet: the super app's identity is what joins.
  it("posts the vehicle with the super app's token, not a team token", async () => {
    useSessionStore.getState().setToken("stale-team-tok");
    apiClient.defaults.adapter = replyWith(joinResponse);

    await sessionService.join("v1");

    expect(sent[0].url).toBe("/sessions/join");
    expect(sent[0].method).toBe("post");
    expect(sent[0].headers.Authorization).toBe("Bearer super-app-tok");
    expect(bodyOf(sent[0])).toEqual({ vehicleId: "v1" });
  });

  it("keeps the team token in the store and in storage", async () => {
    apiClient.defaults.adapter = replyWith(joinResponse);

    const result = await sessionService.join("v1");

    expect(result.token).toBe("team-tok");
    expect(useSessionStore.getState().token).toBe("team-tok");
    expect(useSessionStore.getState().session?.id).toBe("s1");
    await expect(teamTokenStorage.load()).resolves.toBe("team-tok");
  });

  it("maps the wire session into the model", async () => {
    apiClient.defaults.adapter = replyWith(joinResponse);

    const { session, device: me } = await sessionService.join("v1");

    expect(session.startedAt).toEqual(new Date("2027-02-13T03:30:00Z"));
    expect(session.finishedAt).toBeNull();
    expect(me.joinedAt).toEqual(new Date("2027-02-13T03:00:00Z"));
  });
});

describe("getState", () => {
  const state: SessionStateDTO = {
    session: sessionDTO,
    vehicleCode: "PKT-001",
    teamName: "Data Dashers",
    eventStatus: "active",
    startTime: "09:00",
    startsAt: "2027-02-13T03:30:00Z",
    cipher: "",
    startCircle: { lat: 6.89, lng: 79.92, radiusM: 40, placed: true },
    finishCircle: { lat: 6.84, lng: 79.92, radiusM: 30, placed: true },
    waypoints: [],
    nextWaypointId: "",
    crew: [device],
    you: device,
    sharingCount: 0,
    coverageLost: true,
  };

  it("maps the start instant, the cipher and coverage", async () => {
    apiClient.defaults.adapter = replyWith(state);

    const got = await sessionService.getState();

    expect(sent[0].url).toBe("/sessions/me");
    expect(got.startsAt).toEqual(new Date("2027-02-13T03:30:00Z"));
    expect(got.cipher).toBeNull();
    expect(got.nextWaypointId).toBeNull();
    expect(got.coverageLost).toBe(true);
    expect(got.session.totalScore).toBe(640);
  });

  it("passes a revealed cipher through", async () => {
    apiClient.defaults.adapter = replyWith({ ...state, cipher: "API Integration", nextWaypointId: "wp-1" });

    const got = await sessionService.getState();

    expect(got.cipher).toBe("API Integration");
    expect(got.nextWaypointId).toBe("wp-1");
  });

  it("is exposed as TanStack query options", () => {
    const options = sessionService.session.state();

    expect(options.queryKey).toEqual(["session", "state"]);
    expect(typeof options.queryFn).toBe("function");
  });
});

describe("ping", () => {
  const pingResponse = { unlockedTaskIds: ["t1"], currentWaypointId: "", arrived: false, events: [] };

  it("reports a live fix without a timestamp", async () => {
    apiClient.defaults.adapter = replyWith(pingResponse);

    const result = await sessionService.ping({ lat: 6.9, lng: 79.9, accuracy: 8 });

    expect(sent[0].url).toBe("/sessions/me/location");
    expect(bodyOf(sent[0])).toEqual({ lat: 6.9, lng: 79.9, accuracy: 8 });
    expect(result.unlockedTaskIds).toEqual(["t1"]);
    expect(result.currentWaypointId).toBeNull();
  });

  // BE-20: a buffered fix judged by arrival time reads as a teleport.
  it("forwards when a buffered fix was taken", async () => {
    apiClient.defaults.adapter = replyWith(pingResponse);

    await sessionService.ping({ lat: 6.9, lng: 79.9, accuracy: 8, takenAt: new Date("2027-02-13T03:40:00.250Z") });

    expect(bodyOf(sent[0])).toEqual({ lat: 6.9, lng: 79.9, accuracy: 8, ts: "2027-02-13T03:40:00.250Z" });
  });
});

describe("the rest of the in-car surface", () => {
  it("submits a task's payload as-is to that task", async () => {
    apiClient.defaults.adapter = replyWith({ correct: true, awardedPoints: 50, detail: "" });

    const result = await sessionService.submit("task/1", { answer: "API Integration" });

    expect(sent[0].url).toBe("/sessions/me/tasks/task%2F1/submit");
    expect(bodyOf(sent[0])).toEqual({ answer: "API Integration" });
    expect(result).toEqual({ correct: true, awardedPoints: 50, detail: "" });
  });

  it("finishes the run", async () => {
    apiClient.defaults.adapter = replyWith({ ...sessionDTO, status: "finished", finishedAt: "2027-02-13T08:00:00Z" });

    const session = await sessionService.finish();

    expect(sent[0].url).toBe("/sessions/me/finish");
    expect(session.status).toBe("finished");
    expect(session.finishedAt).toEqual(new Date("2027-02-13T08:00:00Z"));
  });

  it("reads the vouchers", async () => {
    apiClient.defaults.adapter = replyWith({ entryCode: "A1B2C3", lockerId: "L-07", lunchPasses: 4 });

    await expect(sessionService.getVouchers()).resolves.toEqual({
      entryCode: "A1B2C3",
      lockerId: "L-07",
      lunchPasses: 4,
    });
  });

  it("raises a crew alert, sending null for a missing position", async () => {
    apiClient.defaults.adapter = replyWith({
      id: "a1",
      vehicleId: "v1",
      type: "breakdown",
      note: "Flat tyre",
      source: "crew",
      raisedAt: "2027-02-13T05:00:00Z",
      resolvedAt: null,
    });

    const alert = await sessionService.raiseAlert({ type: "breakdown", note: "Flat tyre" });

    expect(bodyOf(sent[0])).toEqual({ type: "breakdown", note: "Flat tyre", lat: null, lng: null });
    expect(alert.raisedAt).toEqual(new Date("2027-02-13T05:00:00Z"));
  });
});
