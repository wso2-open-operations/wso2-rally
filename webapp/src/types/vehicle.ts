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

/** A vehicle's health during the rally. Mirrors `vehicles.Status`. */
export type VehicleStatus = "ok" | "breakdown" | "device_issue";

/** A crew member's seat. Mirrors `vehicles.CrewRole`. */
export type CrewRole = "navigator" | "node";

/**
 * One person in a vehicle. Mirrors the backend `CrewMemberDTO`.
 *
 * `email` is required, not decoration: the in-car app is embedded in the WSO2
 * Open Super App, which authenticates the person, and `POST /sessions/join`
 * matches that identity against this address. A blank one leaves them unable to
 * start on rally morning. `phoneNumber` is required too, but only so an
 * organizer can call a car that goes quiet.
 */
export interface CrewMember {
  /** Empty for a row the organizer has just added and not yet saved. */
  id: string;
  name: string;
  /** The WSO2 address the super app signs this member in with. */
  email: string;
  phoneNumber: string;
  role: CrewRole;
  originCountry: string;
}

/** One rally car with its crew. Mirrors the backend `VehicleDTO`. */
export interface Vehicle {
  id: string;
  eventId: string;
  /** The organizer-facing identifier, e.g. PKT-001. */
  code: string;
  teamName: string;
  vehicleType: string;
  contactNumber: string;
  /** Empty until the vehicle is assigned a course. */
  routeId: string;
  status: VehicleStatus;
  crew: CrewMember[];
}

/** `POST /events/{eventId}/vehicles` body. */
export interface CreateVehicleRequest {
  code: string;
  teamName: string;
  vehicleType: string;
  contactNumber: string;
  routeId: string;
  crew: CrewMemberRequest[];
}

/** One crew member on a create or update body — no id; the server assigns them. */
export interface CrewMemberRequest {
  name: string;
  email: string;
  phoneNumber: string;
  role: CrewRole;
  originCountry: string;
}

/**
 * `PATCH /vehicles/{vehicleId}` body — an omitted field is left unchanged.
 *
 * A supplied `crew` replaces the whole roster and the replacements get new ids,
 * so it must always be the complete list.
 */
export type UpdateVehicleRequest = Partial<CreateVehicleRequest> & {
  status?: VehicleStatus;
};

/** `POST /events/{eventId}/vehicles/search` body. */
export interface SearchVehiclesRequest {
  offset: number;
  limit: number;
  filters: {
    /** Matches the vehicle code or the team name. */
    query: string;
    /** Restricts the result to one course. */
    routeId: string;
  };
}

/** What `POST /events/{eventId}/vehicles/import` reports. */
export interface ImportResult {
  imported: number;
}

/** The vehicle types the form offers. Free text on the wire; these are the common ones. */
export const VEHICLE_TYPES = ["SUV", "Sedan", "Van", "Pickup", "Hatchback"] as const;

/** Human labels for a crew seat. */
export const CREW_ROLE_LABELS: Record<CrewRole, string> = {
  navigator: "Navigator",
  node: "Node",
};

/** Human labels and chip colours for a vehicle's health. */
export const VEHICLE_STATUS_META: Record<
  VehicleStatus,
  { label: string; color: "success" | "error" | "warning" }
> = {
  ok: { label: "OK", color: "success" },
  breakdown: { label: "Breakdown", color: "error" },
  device_issue: { label: "Device issue", color: "warning" },
};

/**
 * The fewest digits a crew phone number may carry, mirroring
 * `vehicles.MinPhoneDigits`. The join check compares the last four, so anything
 * shorter could not identify its owner.
 */
export const MIN_PHONE_DIGITS = 4;

/**
 * Checks an address the same shallow way the backend does — one `@` with
 * something either side, and no spaces.
 *
 * Deliberately not a strict RFC pattern: a stricter rule rejects real
 * addresses, and the address is actually proved by Asgardeo when the member
 * joins, not by this form.
 *
 * @param {string} email - The address as typed.
 * @returns {boolean} Whether it could be an email address.
 */
export function looksLikeEmail(email: string): boolean {
  const trimmed = email.trim();
  const [local, domain, ...rest] = trimmed.split("@");

  return rest.length === 0 && Boolean(local) && Boolean(domain) && !/\s/.test(trimmed);
}

/**
 * Counts the digits in a phone number, ignoring spaces, dashes and a leading
 * `+` — organizers paste numbers in whatever shape their spreadsheet holds.
 *
 * @param {string} phoneNumber - The number as typed.
 * @returns {number} How many digits it contains.
 */
export function digitCount(phoneNumber: string): number {
  return (phoneNumber.match(/\d/g) ?? []).length;
}

/** The blank crew row the "+ Crew member" button appends. */
export const emptyCrewMember = (): CrewMember => ({
  id: "",
  name: "",
  email: "",
  phoneNumber: "",
  role: "node",
  originCountry: "",
});
