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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventForm from "@features/events/components/EventForm";
import type { RallyEvent } from "@/types/event";
import { reverseGeocode, searchPlace, type GeocodedPlace } from "@utils/geocoding";

// The global react-leaflet stub makes useMapEvents a no-op, so MapPicker's
// click handler never fires in a test — there is no way to simulate "the
// organizer clicked the map" through it. Mocking MapPicker itself exposes the
// onChange each instance was given, keyed by its label, so a click is a
// direct call rather than an unreachable DOM event.
const mapPickerOnChange: Record<string, (position: { lat: number; lng: number }) => void> = {};
vi.mock("@components/map-picker/MapPicker", () => ({
  default: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (position: { lat: number; lng: number }) => void;
  }) => {
    mapPickerOnChange[label] = onChange;

    return null;
  },
}));

// searchPlace/reverseGeocode wrap the real implementation by default, so every
// existing test below still exercises the real throttle + fetch + parsing
// pipeline via fetchMock. The two race tests override one call each with
// mockImplementationOnce to control resolution order directly — deliberately
// bypassing the real geocoder's 1-request-per-second throttle, which is
// geocoding.ts's own concern and is covered in its own test file. Mixing the
// two here would make these tests wait out real throttle delays left over from
// whichever test ran before them in this file.
vi.mock("@utils/geocoding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@utils/geocoding")>();

  return {
    ...actual,
    searchPlace: vi.fn(actual.searchPlace),
    reverseGeocode: vi.fn(actual.reverseGeocode),
  };
});

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

/** A promise this file can resolve from outside, for controlling fetch order. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

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

describe("EventForm place lookup", () => {
  const fetchMock = vi.fn();

  const nominatim = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const searchPlaceMock = vi.mocked(searchPlace);
  const reverseGeocodeMock = vi.mocked(reverseGeocode);

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    searchPlaceMock.mockClear();
    reverseGeocodeMock.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  // Typing a place and pressing Enter must move the pin, not submit the form —
  // the surrounding <form>'s default action is Save.
  it("moves the start pin to a typed place on Enter, without saving", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      nominatim([
        {
          lat: "6.7148",
          lon: "79.9894",
          display_name: "Bandaragama, Kalutara District, Western Province, Sri Lanka",
          name: "Bandaragama",
          address: { town: "Bandaragama", county: "Kalutara District" },
        },
      ]),
    );
    const props = renderForm();

    const field = screen.getByLabelText(/start location/i);
    await user.clear(field);
    await user.type(field, "bandaragama{Enter}");

    // The field takes the canonical short name, confirming which match won.
    await waitFor(() => expect(field).toHaveValue("Bandaragama"));
    expect(props.onSave).not.toHaveBeenCalled();
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toContain("/search");
    expect(url.searchParams.get("q")).toBe("bandaragama");
  });

  it("says so when the place cannot be found, and leaves the text alone", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(nominatim([]));
    renderForm();

    const field = screen.getByLabelText(/end location/i);
    await user.clear(field);
    await user.type(field, "nowhere at all{Enter}");

    expect(await screen.findByText(/No place found by that name/i)).toBeInTheDocument();
    expect(field).toHaveValue("nowhere at all");
  });

  // The search button is the discoverable half of the same action — an organizer
  // should not have to guess that Enter does something.
  it("searches from the button too", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      nominatim([
        { lat: "7.29", lon: "80.63", display_name: "Kandy, Central Province", name: "Kandy" },
      ]),
    );
    renderForm();

    await user.type(screen.getByLabelText(/start location/i), "kandy");
    await user.click(screen.getByRole("button", { name: /Find the start point on the map/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(/start location/i)).toHaveValue("Kandy"),
    );
  });

  // The clicked coordinates are authoritative and must land even if naming them
  // fails, so a slow or blocked geocoder still leaves a usable pin.
  it("keeps the clicked position when the geocoder cannot name it", async () => {
    fetchMock.mockResolvedValue(nominatim({ error: "Unable to geocode" }));
    renderForm();

    mapPickerOnChange["Start grid geofence"]({ lat: 1.23, lng: 4.56 });

    await waitFor(() =>
      expect(screen.getByLabelText(/start location/i)).toHaveValue(""),
    );
    // The label stays empty (nothing to call it) but the pin itself is not
    // rolled back — that assertion lives with EventForm's own state, not the
    // stubbed MapPicker, since the mock above never actually moves a marker.
  });

  // A user can start a lookup, then start a second one for the same boundary
  // before the first resolves — search again, or click a new point. Whichever
  // one *finishes* last must not decide the boundary; whichever was issued
  // last should.
  it("does not let a slower, older lookup overwrite a newer one", async () => {
    const user = userEvent.setup();
    const first = deferred<GeocodedPlace | null>();
    const second = deferred<GeocodedPlace | null>();
    searchPlaceMock.mockImplementationOnce(() => first.promise);
    searchPlaceMock.mockImplementationOnce(() => second.promise);

    renderForm();

    const field = screen.getByLabelText(/start location/i);
    await user.type(field, "old place{Enter}");
    await user.clear(field);
    await user.type(field, "new place{Enter}");

    await waitFor(() => expect(searchPlaceMock).toHaveBeenCalledTimes(2));

    // Resolve out of order: the newer lookup answers first, the older,
    // superseded one answers last — the failure mode the finding describes.
    second.resolve({ lat: 1, lng: 1, label: "New Place" });
    await waitFor(() => expect(field).toHaveValue("New Place"));

    // Nothing to await on the resolution itself — a stale response settling
    // and doing nothing produces no observable event — so flush it under act
    // and re-assert directly.
    await act(async () => {
      first.resolve({ lat: 2, lng: 2, label: "Old Place" });
      await Promise.resolve();
    });
    expect(field).toHaveValue("New Place");
  });

  // The same race, between a typed search and a map click racing for the same
  // boundary — the two ways of moving a pin share one generation counter.
  it("does not let a stale search overwrite a newer map click", async () => {
    const user = userEvent.setup();
    const search = deferred<GeocodedPlace | null>();
    searchPlaceMock.mockImplementationOnce(() => search.promise);
    // Never resolves within this test: the click's own naming is not what is
    // under test, only that the stale search must not pre-empt it.
    reverseGeocodeMock.mockImplementation(() => new Promise(() => {}));

    renderForm();

    await user.type(screen.getByLabelText(/start location/i), "old place{Enter}");
    mapPickerOnChange["Start grid geofence"]({ lat: 6.9, lng: 79.9 });

    await waitFor(() => expect(searchPlaceMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reverseGeocodeMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      search.resolve({ lat: 2, lng: 2, label: "Old Place" });
      await Promise.resolve();
    });

    // The click's own reverse-geocode never resolves in this test, so the
    // stale search relabelling the field would be the only way it could ever
    // read "Old Place".
    expect(screen.getByLabelText(/start location/i)).not.toHaveValue("Old Place");
  });
});
