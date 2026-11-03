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

/**
 * Distance on the Earth's surface, mirrored from the backend's `internal/geo`.
 *
 * The server does every geofence decision that counts. The phone uses these
 * only to tell the crew where they stand — so they must give the same answer
 * the server would, or a screen unlocks where the server would not.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

const radians = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const sinLat = Math.sin(radians(b.lat - a.lat) / 2);
  const sinLng = Math.sin(radians(b.lng - a.lng) / 2);
  const h = sinLat * sinLat + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * sinLng * sinLng;

  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Whether a point lies within `radiusM` of a centre, edge included. A negative radius never matches. */
export function pointInRadius(point: LatLng, center: LatLng, radiusM: number): boolean {
  if (radiusM < 0) return false;

  return haversineMeters(point, center) <= radiusM;
}

/** "62 m" under a kilometre, "4.7 km" from there. */
export function formatDistance(meters: number): string {
  return meters < 1_000 ? `${Math.round(meters)} m` : `${(meters / 1_000).toFixed(1)} km`;
}
