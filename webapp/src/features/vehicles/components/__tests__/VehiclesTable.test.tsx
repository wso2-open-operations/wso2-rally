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
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VehiclesTable from "@features/vehicles/components/VehiclesTable";
import type { RallyRoute } from "@/types/route";
import type { Vehicle } from "@/types/vehicle";

const crew = (name: string, phoneNumber: string) => ({
  id: `c-${name}`,
  name,
  phoneNumber,
  role: "node" as const,
  originCountry: "LK",
});

const vehicles: Vehicle[] = [
  {
    id: "v1",
    eventId: "e1",
    code: "PKT-001",
    teamName: "Data Dashers",
    vehicleType: "SUV",
    contactNumber: "071 234 5678",
    routeId: "r1",
    status: "ok",
    crew: [crew("Nimal", "0771234567"), crew("Ayesha", "0777654321")],
  },
  {
    id: "v2",
    eventId: "e1",
    code: "PKT-002",
    teamName: "Sync Squad",
    vehicleType: "Sedan",
    contactNumber: "077 987 6543",
    routeId: "",
    status: "breakdown",
    crew: [],
  },
];

const routes: RallyRoute[] = [
  { id: "r1", eventId: "e1", name: "Inland", order: 0 },
  { id: "r2", eventId: "e1", name: "Wetlands", order: 1 },
];

const renderTable = (
  overrides: Partial<React.ComponentProps<typeof VehiclesTable>> = {},
) => {
  const props = {
    vehicles,
    routes,
    isLoading: false,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<VehiclesTable {...props} />);

  return props;
};

describe("VehiclesTable", () => {
  it("renders the wireframe's columns, including Contact and Type", () => {
    renderTable();

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(
      expect.arrayContaining(["Vehicle", "Team", "Crew", "Contact", "Type", "Route"]),
    );
    expect(screen.getByText("071 234 5678")).toBeInTheDocument();
    expect(screen.getByText("SUV")).toBeInTheDocument();
  });

  it("shows the crew headcount, not the names", () => {
    renderTable();

    const row = screen.getByRole("row", { name: /PKT-001/ });
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).queryByText("Nimal")).not.toBeInTheDocument();
  });

  // routeId is an opaque id on the wire; an organizer reads course names.
  it("resolves the route id to its name, and says so when unassigned", () => {
    renderTable();

    expect(screen.getByText("Inland")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("flags a vehicle that is not running normally", () => {
    renderTable();

    expect(screen.getByText("Breakdown")).toBeInTheDocument();
  });

  it("tells an organizer what to do with an empty fleet", () => {
    renderTable({ vehicles: [] });

    expect(screen.getByText(/No vehicles yet/i)).toBeInTheDocument();
  });

  it("hands the whole vehicle to the edit handler", async () => {
    const user = userEvent.setup();
    const props = renderTable();

    await user.click(
      within(screen.getByRole("row", { name: /PKT-002/ })).getByRole("button", {
        name: "Edit PKT-002",
      }),
    );

    expect(props.onEdit).toHaveBeenCalledWith(vehicles[1]);
  });
});
