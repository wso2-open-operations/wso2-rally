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

/**
 * Saves a blob to the user's downloads as `filename`.
 *
 * The export endpoint needs an `Authorization` header, so the file cannot be
 * fetched by pointing an `<a href>` or a new tab at it — the browser would send
 * an unauthenticated request. It is fetched through the API client instead and
 * handed to the browser here, which is why this exists at all.
 *
 * The object URL is revoked on the next tick rather than immediately: Safari
 * reads the URL asynchronously after the click and gets an empty file if it has
 * already been released.
 *
 * @param {Blob} blob - The file contents.
 * @param {string} filename - The name to save it as.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Builds a dated filename, so an organizer exporting twice in a day does not
 * end up with `vehicles (3).csv` and no idea which is current.
 *
 * @param {string} prefix - The leading part of the name, e.g. "vehicles".
 * @param {Date} on - The date to stamp.
 * @returns {string} A name like `vehicles-2027-02-13.csv`.
 */
export function csvFilename(prefix: string, on: Date = new Date()): string {
  const stamp = [
    on.getFullYear(),
    String(on.getMonth() + 1).padStart(2, "0"),
    String(on.getDate()).padStart(2, "0"),
  ].join("-");

  return `${prefix}-${stamp}.csv`;
}

/**
 * The provisioning file's columns, in the order the backend requires
 * (`vehicles.csvHeader`). A file whose header differs is rejected whole, so the
 * template offered in the UI has to agree with this exactly.
 */
export const VEHICLE_CSV_HEADER = [
  "code",
  "team_name",
  "vehicle_type",
  "contact_number",
  "route_name",
  "crew_names",
] as const;

/**
 * A one-row example file, for the "download a template" link on the import
 * dialog. `crew_names` entries are `Name:email:phone`, joined by `|`. None of
 * the three is optional: the email is how the in-car app recognises a member,
 * and the phone is how an organizer reaches a silent car.
 */
export const VEHICLE_CSV_TEMPLATE = [
  VEHICLE_CSV_HEADER.join(","),
  "PKT-001,Data Dashers,SUV,0712345678,Inland," +
    "Nimal Perera:nimal@wso2.com:0771234567|Ayesha Fernando:ayesha@wso2.com:0777654321",
  "",
].join("\n");
