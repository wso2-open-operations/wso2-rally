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
import WaypointList from "@features/routes/components/WaypointList";
import type { Waypoint } from "@/types/route";
import type { RallyTask } from "@/types/task";

const waypoint = (id: string, order: number, label: string, taskIds: string[] = []): Waypoint => ({
  id,
  routeId: "r1",
  order,
  label,
  lat: 6.89,
  lng: 79.92,
  boundaryRadiusM: 50,
  taskIds,
});

const waypoints = [
  waypoint("w1", 0, "Start grid"),
  waypoint("w2", 1, "Parliament Rd", ["t1"]),
  waypoint("w3", 2, "Maharagama"),
];

const tasks: RallyTask[] = [
  {
    id: "t1",
    eventId: "e1",
    code: "T1",
    title: "Translation Cipher",
    type: "INPUT_SELECT",
    trigger: "geofence",
    points: 50,
    sensor: "none",
    config: {},
  },
  {
    id: "t6",
    eventId: "e1",
    code: "T6",
    title: "Barcode Scan",
    type: "SCAN_BARCODE",
    trigger: "geofence",
    points: 40,
    sensor: "camera",
    config: {},
  },
];

const renderList = (
  overrides: Partial<React.ComponentProps<typeof WaypointList>> = {},
) => {
  const props = {
    waypoints,
    tasks,
    expandedId: null,
    isBusy: false,
    onExpand: vi.fn(),
    onReorder: vi.fn(),
    onRadiusChange: vi.fn(),
    onAttachTasks: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<WaypointList {...props} />);

  return props;
};

describe("WaypointList", () => {
  // The backend rejects anything that is not a permutation of the whole route,
  // so a reorder has to send every id, not just the pair that moved.
  it("sends the full swapped order when the second waypoint moves up", async () => {
    const user = userEvent.setup();
    const props = renderList();

    await user.click(screen.getByRole("button", { name: "Move Parliament Rd up" }));

    expect(props.onReorder).toHaveBeenCalledWith(["w2", "w1", "w3"]);
  });

  it("swaps downwards too", async () => {
    const user = userEvent.setup();
    const props = renderList();

    await user.click(screen.getByRole("button", { name: "Move Parliament Rd down" }));

    expect(props.onReorder).toHaveBeenCalledWith(["w1", "w3", "w2"]);
  });

  // The ends of the route have nowhere to go; offering the move would send an
  // unchanged order to the server.
  it("disables the moves that would run off the ends", () => {
    renderList();

    expect(screen.getByRole("button", { name: "Move Start grid up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Maharagama down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Start grid down" })).toBeEnabled();
  });

  it("shows each waypoint's boundary radius in the collapsed row", () => {
    renderList();

    expect(screen.getAllByText("50 m")).toHaveLength(3);
  });

  // Attaching is a whole-set replace, so removing one chip must resend the rest.
  it("detaches a task by resending the remaining ids", async () => {
    const user = userEvent.setup();
    const props = renderList({
      expandedId: "w2",
      waypoints: [
        waypoints[0],
        waypoint("w2", 1, "Parliament Rd", ["t1", "t6"]),
        waypoints[2],
      ],
    });

    const panel = screen.getByRole("group", { name: "Parliament Rd settings" });
    await user.click(within(panel).getByRole("button", { name: "Detach T1" }));

    expect(props.onAttachTasks).toHaveBeenCalledWith("w2", ["t6"]);
  });

  it("offers only the tasks that are not already attached", async () => {
    const user = userEvent.setup();
    renderList({ expandedId: "w2" });

    const panel = screen.getByRole("group", { name: "Parliament Rd settings" });
    await user.click(within(panel).getByLabelText("Add task"));

    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "T6 · Barcode Scan",
    ]);
  });

  it("tells an organizer what to do with an empty route", () => {
    renderList({ waypoints: [] });

    expect(screen.getByText(/No waypoints yet/i)).toBeInTheDocument();
  });
});
