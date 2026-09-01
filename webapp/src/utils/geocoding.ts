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

import { getMapConfig } from "@config/mapConfig";

/**
 * Place lookup against a Nominatim-compatible geocoder, for the A2 event-setup
 * form: typing a place moves the pin, and clicking the map names the pin.
 *
 * Two rules govern this file.
 *
 * **Plain `fetch`, never `useAuthApiClient`.** That client attaches the
 * organizer's id token to every request; pointing it at a third party would
 * hand our credential to someone else's server.
 *
 * **No autocomplete.** Nominatim's usage policy forbids as-you-type querying,
 * so the caller searches on Enter or a button press and never on keystroke, and
 * `throttle` below refuses to exceed one request a second whatever the UI does.
 */

/** One request a second, as the Nominatim usage policy requires. */
const MIN_REQUEST_INTERVAL_MS = 1_000;

/** A slow geocoder must not hold the form hostage. */
const REQUEST_TIMEOUT_MS = 8_000;

/** How far around the configured centre results are *preferred* (not limited). */
const VIEWBOX_DEGREES = 1.5;

/** A resolved place: where it is, and what to call it. */
export interface GeocodedPlace {
  lat: number;
  lng: number;
  /** Short enough for a map tooltip — see `shortPlaceName`. */
  label: string;
}

/** The subset of a Nominatim result this app reads. */
export interface NominatimPlace {
  display_name: string;
  name?: string;
  lat?: string;
  lon?: string;
  address?: Record<string, string | undefined>;
}

/** Address keys that name a settlement, most specific first. */
const SETTLEMENT_KEYS = ["city", "town", "village", "suburb", "county"] as const;

/** Address keys that name a feature when the result has no `name`. */
const FEATURE_KEYS = ["road", "neighbourhood", "hamlet", "suburb"] as const;

const firstOf = (
  address: Record<string, string | undefined> | undefined,
  keys: readonly string[],
): string => {
  for (const key of keys) {
    const value = address?.[key]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
};

/**
 * Reduces a geocoder result to a caption an organizer can read at a glance.
 *
 * `Boundary.label` is not just a form field: A3's route map and A6's live
 * monitor render it as a tooltip. A full `display_name` — "Diyatha Uyana, Japan
 * Friendship Road, Sri Jayawardenepura Kotte, Colombo District, Western
 * Province, 10120, Sri Lanka" — is unreadable there, so this keeps at most the
 * feature and its settlement.
 *
 * @param {NominatimPlace} place - A geocoder result.
 * @returns {string} A short caption, or "" when nothing usable came back.
 */
export function shortPlaceName(place: NominatimPlace): string {
  const feature = place.name?.trim() || firstOf(place.address, FEATURE_KEYS);
  const settlement = firstOf(place.address, SETTLEMENT_KEYS);

  const parts = [feature, settlement].filter(
    (part, index, all) => part !== "" && all.indexOf(part) === index,
  );
  if (parts.length > 0) {
    return parts.join(", ");
  }

  // No structured address — some providers omit it. Take the leading parts of
  // the display name rather than the whole postal string.
  return place.display_name
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
}

let lastRequestAt = 0;

/** Spaces requests out to honour the provider's rate limit. */
async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

/**
 * Fetches JSON from the geocoder, resolving null on any failure.
 *
 * Every failure mode here — offline, a corporate proxy, a 429, a provider
 * outage — is one an organizer can work around by dropping the pin by hand. So
 * this reports nothing rather than raising: the caller shows "not found" and the
 * form stays usable. That is a considered exception to the repo's no-silent-
 * fallback rule, which is about never inventing data; this invents nothing.
 */
async function getJson<T>(url: URL): Promise<T | null> {
  await throttle();

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Biases results towards wherever this deployment's map opens. */
function preferNearDefaultCentre(url: URL): void {
  const { defaultCenter } = getMapConfig();
  const { lat, lng } = defaultCenter;
  // left,top,right,bottom — a preference, not a restriction, so a rally
  // configured elsewhere still finds places outside the box.
  url.searchParams.set(
    "viewbox",
    [
      lng - VIEWBOX_DEGREES,
      lat + VIEWBOX_DEGREES,
      lng + VIEWBOX_DEGREES,
      lat - VIEWBOX_DEGREES,
    ].join(","),
  );
}

/**
 * Finds a place by name, for "type a city and move the pin".
 *
 * @param {string} query - What the organizer typed.
 * @returns {Promise<GeocodedPlace | null>} The best match, or null if there is none.
 */
export async function searchPlace(query: string): Promise<GeocodedPlace | null> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return null;
  }

  const url = new URL(`${getMapConfig().geocodeUrl}/search`);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  preferNearDefaultCentre(url);

  const results = await getJson<NominatimPlace[]>(url);
  const first = Array.isArray(results) ? results[0] : undefined;
  if (!first) {
    return null;
  }

  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng, label: shortPlaceName(first) };
}

/**
 * Names a coordinate, for "click the map and fill the field".
 *
 * @param {number} lat - Latitude of the clicked point.
 * @param {number} lng - Longitude of the clicked point.
 * @returns {Promise<string | null>} A short caption, or null if the point has no name.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const url = new URL(`${getMapConfig().geocodeUrl}/reverse`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  // Roughly neighbourhood level. Finer returns a house number, which is noise
  // for a start grid in a field; coarser returns a district.
  url.searchParams.set("zoom", "16");

  const place = await getJson<NominatimPlace>(url);
  if (!place?.display_name) {
    return null;
  }

  return shortPlaceName(place) || null;
}
