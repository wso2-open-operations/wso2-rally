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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventForm from "@features/events/components/EventForm";
import type { RallyEvent } from "@/types/event";

const placedEvent: RallyEvent = {
  id: "e1",
  name: "Motor Rally 2027",
  eventDate: "2027-03-14",
  startTime: "09:00",
  status: "setup",
  start: { label: "Diyatha Uyana grid", lat: 6.8901, lng: 79.92, radiusM: 40 },
  end: { label: "Pearl Bay, Bandaragama", lat: 6.848, lng: 79.928, radiusM: 30 },
  cipher: "API Integration",
  createdBy: "organizer@wso2.com",
  createdOn: "2026-08-07T00:00:00Z",
  routes: [],
};

const renderForm = (overrides: Partial<React.ComponentProps<typeof EventForm>> = {}) => {
  const props = {
    event: undefined,
    isSaving: false,
    isPublishing: false,
    onSave: vi.fn(),
    onPublish: vi.fn(),
    ...overrides,
  };
  render(<EventForm {...props} />);

  return props;
};

describe("EventForm", () => {
  // 09:00 is the synchronised start the whole rally is built around, so a new
  // event should not make an organizer type it.
  it("defaults a new event to a 09:00 start", () => {
    renderForm();

    expect(screen.getByLabelText(/auto-start time/i)).toHaveValue("09:00");
  });

  it("prefills every field from an existing event", () => {
    renderForm({ event: placedEvent });

    expect(screen.getByLabelText(/event name/i)).toHaveValue("Motor Rally 2027");
    expect(screen.getByLabelText(/date/i)).toHaveValue("2027-03-14");
    expect(screen.getByLabelText(/start location/i)).toHaveValue("Diyatha Uyana grid");
    expect(screen.getByLabelText(/start boundary radius/i)).toHaveValue(40);
    expect(screen.getByLabelText(/end location/i)).toHaveValue("Pearl Bay, Bandaragama");
    expect(screen.getByLabelText(/end boundary radius/i)).toHaveValue(30);
    expect(screen.getByLabelText(/cipher/i)).toHaveValue("API Integration");
  });

  it("submits the edited values", async () => {
    const user = userEvent.setup();
    const { onSave } = renderForm({ event: placedEvent });

    await user.clear(screen.getByLabelText(/event name/i));
    await user.type(screen.getByLabelText(/event name/i), "Renamed Rally");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Renamed Rally",
        eventDate: "2027-03-14",
        startTime: "09:00",
        start: expect.objectContaining({ lat: 6.8901, radiusM: 40 }),
      }),
    );
  });

  // The backend rejects a nameless event; catching it here saves a round trip
  // and points at the field rather than showing a banner.
  it("blocks a save with no name", async () => {
    const user = userEvent.setup();
    const { onSave } = renderForm();

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });

  // Publishing is what the backend refuses without both geofences, so the
  // button must not promise something that will 400.
  it("cannot publish until both geofences are placed", () => {
    renderForm({
      event: { ...placedEvent, end: { ...placedEvent.end, lat: null, lng: null } },
    });

    expect(screen.getByRole("button", { name: /publish/i })).toBeDisabled();
  });

  it("enables publish once both geofences are placed", () => {
    renderForm({ event: placedEvent });

    expect(screen.getByRole("button", { name: /publish/i })).toBeEnabled();
  });

  // A completed event is read-only server-side.
  it("locks every control on a completed event", () => {
    renderForm({ event: { ...placedEvent, status: "complete" } });

    expect(screen.getByLabelText(/event name/i)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
  });

  it("hides publish for an event that is already active", () => {
    renderForm({ event: { ...placedEvent, status: "active" } });

    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });
});
