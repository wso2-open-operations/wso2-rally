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
import { shortPlaceName } from "@utils/geocoding";

/**
 * Loads a fresh copy of the module for each test.
 *
 * The 1 req/s throttle keeps its "last request" timestamp in module scope, so a
 * shared import would make every test after the first wait a real second — and
 * leak state between them, which is the worse half of that.
 */
const freshGeocoding = async () => {
  vi.resetModules();

  return import("@utils/geocoding");
};

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("shortPlaceName", () => {
  // The point of this function: `label` is the caption the A3 route map and the
  // A6 live monitor show. Nominatim's display_name is a full postal address, and
  // putting that on a tooltip an organizer reads under pressure is useless.
  it("keeps the place name and its settlement, not the whole address", () => {
    expect(
      shortPlaceName({
        display_name:
          "Diyatha Uyana, Japan Friendship Road, Sri Jayawardenepura Kotte, Colombo District, Western Province, 10120, Sri Lanka",
        name: "Diyatha Uyana",
        address: {
          road: "Japan Friendship Road",
          city: "Sri Jayawardenepura Kotte",
          county: "Colombo District",
          state: "Western Province",
          country: "Sri Lanka",
        },
      }),
    ).toBe("Diyatha Uyana, Sri Jayawardenepura Kotte");
  });

  it("falls back to the road when there is no place name", () => {
    expect(
      shortPlaceName({
        display_name: "Beach Road, Bandaragama, Kalutara District, Sri Lanka",
        name: "",
        address: { road: "Beach Road", town: "Bandaragama", country: "Sri Lanka" },
      }),
    ).toBe("Beach Road, Bandaragama");
  });

  it("does not repeat itself when the name is the settlement", () => {
    expect(
      shortPlaceName({
        display_name: "Bandaragama, Kalutara District, Western Province, Sri Lanka",
        name: "Bandaragama",
        address: { town: "Bandaragama", county: "Kalutara District" },
      }),
    ).toBe("Bandaragama");
  });

  // A provider that returns no structured address at all must still yield
  // something short rather than the whole string.
  it("trims a bare display_name down to two parts", () => {
    expect(
      shortPlaceName({
        display_name: "Pearl Bay, Bandaragama, Kalutara District, Western Province, Sri Lanka",
      }),
    ).toBe("Pearl Bay, Bandaragama");
  });

  it("returns an empty string when there is nothing usable", () => {
    expect(shortPlaceName({ display_name: "" })).toBe("");
  });
});

describe("searchPlace", () => {
  const fetchMock = vi.fn();

  let searchPlace: typeof import("@utils/geocoding").searchPlace;

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    ({ searchPlace } = await freshGeocoding());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the first match with its coordinates and a short label", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([
        {
          lat: "6.7148",
          lon: "79.9894",
          display_name: "Bandaragama, Kalutara District, Western Province, Sri Lanka",
          name: "Bandaragama",
          address: { town: "Bandaragama", county: "Kalutara District" },
        },
      ]),
    );

    await expect(searchPlace("bandaragama")).resolves.toEqual({
      lat: 6.7148,
      lng: 79.9894,
      label: "Bandaragama",
    });
  });

  it("resolves null when the place is not found", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await expect(searchPlace("nowhere at all")).resolves.toBeNull();
  });

  it("resolves null for a blank query without calling out", async () => {
    await expect(searchPlace("   ")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The token must never reach a third party. This is why geocoding uses plain
  // fetch and not useAuthApiClient.
  it("sends no Authorization header", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await searchPlace("colombo");

    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("asks for structured address details, which shortPlaceName needs", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await searchPlace("colombo");

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toContain("/search");
    expect(url.searchParams.get("q")).toBe("colombo");
    expect(url.searchParams.get("addressdetails")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  // A refused or unreachable geocoder is a normal outcome on a laptop behind a
  // proxy; it must not blow up the setup form.
  it("resolves null when the provider errors", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));

    await expect(searchPlace("colombo")).resolves.toBeNull();
  });

  it("resolves null when the network throws", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(searchPlace("colombo")).resolves.toBeNull();
  });
});

describe("reverseGeocode", () => {
  const fetchMock = vi.fn();

  let reverseGeocode: typeof import("@utils/geocoding").reverseGeocode;

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    ({ reverseGeocode } = await freshGeocoding());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names a clicked point briefly", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        display_name: "Pearl Bay, Bandaragama, Kalutara District, Sri Lanka",
        name: "Pearl Bay",
        address: { town: "Bandaragama" },
      }),
    );

    await expect(reverseGeocode(6.848, 79.928)).resolves.toBe("Pearl Bay, Bandaragama");
  });

  it("resolves null rather than throwing when the point has no name", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Unable to geocode" }));

    await expect(reverseGeocode(0, 0)).resolves.toBeNull();
  });
});

// Nominatim's usage policy caps an application at one request a second. The UI
// only searches on Enter, but a determined organizer can press Enter faster than
// that, so the limit is enforced here rather than trusted to the caller.
describe("the provider rate limit", () => {
  const fetchMock = vi.fn();

  let searchPlace: typeof import("@utils/geocoding").searchPlace;

  beforeEach(async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    ({ searchPlace } = await freshGeocoding());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("spaces two back-to-back searches at least a second apart", async () => {
    const startedAt = Date.now();

    await searchPlace("colombo");
    await searchPlace("kandy");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
  });
});
