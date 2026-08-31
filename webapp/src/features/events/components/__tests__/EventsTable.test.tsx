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
import EventsTable from "@features/events/components/EventsTable";
import { EMPTY_BOUNDARY, type RallyEvent } from "@/types/event";

const baseEvent: RallyEvent = {
  id: "e1",
  name: "Motor Rally 2027",
  eventDate: "2027-03-14",
  startTime: "09:00",
  status: "setup",
  start: EMPTY_BOUNDARY,
  end: EMPTY_BOUNDARY,
  cipher: "",
  createdBy: "organizer@wso2.com",
  createdOn: "2026-08-07T00:00:00Z",
  routes: [
    { id: "r1", name: "Inland" },
    { id: "r2", name: "Wetlands" },
  ],
};

const completedEvent: RallyEvent = {
  ...baseEvent,
  id: "e2",
  name: "Pilot Run",
  eventDate: "2027-02-20",
  startTime: "08:30",
  status: "complete",
  routes: [{ id: "r3", name: "Inland" }],
};

const renderTable = (events: RallyEvent[], onOpen = vi.fn()) => {
  render(<EventsTable events={events} isLoading={false} onOpen={onOpen} />);

  return onOpen;
};

describe("EventsTable", () => {
  it("renders the A1 columns", () => {
    renderTable([baseEvent]);

    const headers = screen
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);

    expect(headers).toEqual(["Event", "Date", "Start", "Route", "Status", ""]);
  });

  // A completed event is read-only server-side, so offering "Edit" would set up
  // a save the backend will reject.
  it("offers Edit while editable and View once complete", () => {
    renderTable([baseEvent, completedEvent]);

    const rows = screen.getAllByRole("row");
    expect(
      within(rows[1]).getByRole("button", { name: "Edit" }),
    ).toBeInTheDocument();
    expect(
      within(rows[2]).getByRole("button", { name: "View" }),
    ).toBeInTheDocument();
  });

  it("shows the start time in 12-hour form and joins the route names", () => {
    renderTable([baseEvent]);

    expect(screen.getByText("09:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Inland + Wetlands")).toBeInTheDocument();
  });

  it("falls back when an event has no routes yet", () => {
    renderTable([{ ...baseEvent, routes: [] }]);

    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("opens the event when the action is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = renderTable([baseEvent]);

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(onOpen).toHaveBeenCalledWith(baseEvent);
  });

  it("tells the organizer when there is nothing to show", () => {
    renderTable([]);

    expect(screen.getByText(/No events yet/i)).toBeInTheDocument();
  });
});
