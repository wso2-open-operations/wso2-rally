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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppProvider from "@context/AppProvider";
import { useSessionStore } from "@store/session";
import type { JoinableVehicle } from "@/types/session.model";
import InitPage from "./InitPage";

const join = vi.fn();
const restoreSession = vi.fn(async () => {});
const listJoinableVehicles = vi.fn<() => Promise<JoinableVehicle[]>>();
const getSuperAppToken = vi.fn(async () => "super-app-tok");
const emailFromToken = vi.fn<(token: string) => string | null>(() => "nimal@wso2.com");

vi.mock("@services/session", () => ({
  join: (vehicleId: string) => join(vehicleId),
  restoreSession: () => restoreSession(),
}));
vi.mock("@services/vehicles", () => ({
  listJoinableVehicles: () => listJoinableVehicles(),
  vehicles: {
    joinable: () => ({ queryKey: ["vehicles", "joinable"], queryFn: () => listJoinableVehicles() }),
  },
}));
vi.mock("@services/auth", () => ({
  getSuperAppToken: () => getSuperAppToken(),
  emailFromToken: (token: string) => emailFromToken(token),
}));

const car = (overrides: Partial<JoinableVehicle> = {}): JoinableVehicle => ({
  vehicleId: "veh1",
  code: "PKT-001",
  teamName: "Data Dashers",
  eventId: "e1",
  eventName: "Motor Rally 2027",
  eventDate: "2027-02-13",
  startTime: "09:00",
  ...overrides,
});

const renderPage = () =>
  render(
    <AppProvider>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<InitPage />} />
          <Route path="/lock" element={<p>start grid</p>} />
        </Routes>
      </MemoryRouter>
    </AppProvider>,
  );

beforeEach(() => {
  useSessionStore.getState().clear();
  join.mockReset();
  listJoinableVehicles.mockReset();
  emailFromToken.mockReturnValue("nimal@wso2.com");
});

describe("InitPage (B1)", () => {
  it("says who is signed in", async () => {
    listJoinableVehicles.mockResolvedValue([car()]);

    renderPage();

    expect(await screen.findByText("nimal@wso2.com")).toBeInTheDocument();
  });

  // The super app already said who this is; the screen asks only which car.
  it("joins the selected vehicle without asking who the user is", async () => {
    listJoinableVehicles.mockResolvedValue([
      car(),
      car({ vehicleId: "veh2", code: "PKT-002", teamName: "Sync Squad" }),
    ]);
    join.mockResolvedValue({ token: "t", session: { id: "s" } });

    renderPage();
    fireEvent.change(await screen.findByLabelText(/your vehicle/i), { target: { value: "veh2" } });
    fireEvent.click(screen.getByRole("button", { name: /join vehicle/i }));

    await waitFor(() => expect(join).toHaveBeenCalledWith("veh2"));
    expect(await screen.findByText("start grid")).toBeInTheDocument();
    expect(screen.queryByLabelText(/last four/i)).toBeNull();
    expect(screen.queryByLabelText(/your name/i)).toBeNull();
  });

  // On one car — the usual case — it is already chosen. Joining still takes a
  // tap: it binds this phone to the car for the whole rally.
  it("preselects the only car but still waits for the tap", async () => {
    listJoinableVehicles.mockResolvedValue([car()]);
    join.mockResolvedValue({ token: "t", session: { id: "s" } });

    renderPage();
    const select = (await screen.findByLabelText(/your vehicle/i)) as HTMLSelectElement;

    expect(select.value).toBe("veh1");
    expect(join).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /join vehicle/i }));
    await waitFor(() => expect(join).toHaveBeenCalledWith("veh1"));
  });

  it("will not join before a car is chosen", async () => {
    listJoinableVehicles.mockResolvedValue([car(), car({ vehicleId: "veh2", code: "PKT-002" })]);

    renderPage();
    await screen.findByLabelText(/your vehicle/i);

    expect(screen.getByRole("button", { name: /join vehicle/i })).toBeDisabled();
  });

  // The usual cause is a typo in the roster. Naming the address is what lets
  // the crew member spot it and tell an organizer.
  it("names the signed-in address when it is on no car's crew", async () => {
    listJoinableVehicles.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(/not on the crew list of any car/i)).toBeInTheDocument();
    expect(screen.getByText(/not on the crew list of any car/i).textContent).toContain("nimal@wso2.com");
    expect(screen.queryByRole("button", { name: /join vehicle/i })).toBeNull();
  });

  // Every refusal arrives as the backend's own sentence — wrong car (403),
  // event not published (409), unknown car (404) — and is shown as-is.
  it("shows the backend's reason when joining fails, and stays put", async () => {
    listJoinableVehicles.mockResolvedValue([car()]);
    join.mockRejectedValue(new Error("This event has not been published yet."));

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /join vehicle/i }));

    expect(await screen.findByText("This event has not been published yet.")).toBeInTheDocument();
    expect(screen.queryByText("start grid")).toBeNull();
  });

  it("offers a retry when the list cannot be loaded", async () => {
    listJoinableVehicles.mockRejectedValueOnce(new Error("Could not reach the rally server."));
    listJoinableVehicles.mockResolvedValueOnce([car()]);

    renderPage();
    expect(await screen.findByText("Could not reach the rally server.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByLabelText(/your vehicle/i)).toBeInTheDocument();
  });

  // A phone that already joined — or was restored after a reload — resumes
  // instead of being asked again.
  it("sends a phone that has already joined on to its rally", async () => {
    useSessionStore.getState().setToken("team-tok");
    listJoinableVehicles.mockResolvedValue([car()]);

    renderPage();

    expect(await screen.findByText("start grid")).toBeInTheDocument();
  });
});
