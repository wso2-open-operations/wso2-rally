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

import { useEffect, type JSX } from "react";
import { Box, Typography } from "@wso2/oxygen-ui";
import {
  Circle,
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { getMapConfig } from "@config/mapConfig";
import type { Boundary } from "@/types/event";
import type { VehicleLive } from "@features/monitor/monitorState";

/** Marker colour by vehicle health, so a stranded car reads at a glance. */
const STATUS_COLORS: Record<string, string> = {
  ok: "#2f8f4e",
  breakdown: "#d13438",
  device_issue: "#ff7300",
};

/** A finished crew is drawn differently from one still running. */
const FINISHED_COLOR = "#1d4ed8";
const BOUNDARY_COLOR = "#2f8f4e";

export interface LiveMapProps {
  vehicles: VehicleLive[];
  start?: Boundary;
  end?: Boundary;
  height?: number;
}

const isPlaced = (
  boundary?: Boundary,
): boundary is Boundary & { lat: number; lng: number } =>
  boundary?.lat != null && boundary?.lng != null;


/**
 * Re-centres the map when the *anchor* changes.
 *
 * `MapContainer` reads `center` and `zoom` only when Leaflet creates the map,
 * so data arriving after mount leaves the view where it started. Keying on the
 * anchor's identity rather than its coordinates matters: a vehicle that is
 * merely moving keeps the same key, so the viewport is not yanked on every
 * position frame.
 *
 * @param {object} props - The anchor key, target centre and zoom.
 * @returns {null} Renders nothing; it only drives the map.
 */
function SyncView({
  anchorKey,
  center,
  zoom,
}: {
  anchorKey: string;
  center: [number, number];
  zoom: number;
}): null {
  const map = useMap();

  useEffect(() => {
    map.setView(center, zoom);
    // Coordinates are deliberately absent: only a new anchor moves the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, map]);

  return null;
}

const colorOf = (vehicle: VehicleLive): string =>
  vehicle.sessionStatus === "finished"
    ? FINISHED_COLOR
    : (STATUS_COLORS[vehicle.status] ?? STATUS_COLORS.ok);

/**
 * A6's map: one marker per reporting vehicle, coloured by status, between the
 * event's start and arrival boundaries.
 *
 * Only vehicles that have reported a position are drawn — a car at 0,0 would
 * put the whole fleet in the Gulf of Guinea.
 *
 * @param {LiveMapProps} props - The vehicles and the event boundaries.
 * @returns {JSX.Element} The live map.
 */
export default function LiveMap({
  vehicles,
  start,
  end,
  height = 480,
}: LiveMapProps): JSX.Element {
  const mapConfig = getMapConfig();
  const placed = vehicles.filter(
    (vehicle) => vehicle.lat !== null && vehicle.lng !== null,
  );
  const first = placed[0];
  const center: [number, number] = first
    ? [first.lat as number, first.lng as number]
    : isPlaced(start)
      ? [start.lat, start.lng]
      : [mapConfig.defaultCenter.lat, mapConfig.defaultCenter.lng];
  const zoom = placed.length > 0 ? 12 : mapConfig.defaultZoom;
  // The first car to report is the anchor. Its code, not its coordinates, so
  // the view settles once rather than chasing it around the course.
  const anchorKey = first?.vehicleCode ?? (isPlaced(start) ? "start" : "default");

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
      <Box
        sx={{
          height,
          borderRadius: 1,
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
          "& .leaflet-container": { height: "100%", width: "100%" },
        }}
      >
        <MapContainer
          center={center}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
          zoom={zoom}
        >
          <TileLayer attribution={mapConfig.attribution} url={mapConfig.tileUrl} />
          <SyncView anchorKey={anchorKey} center={center} zoom={zoom} />

          {isPlaced(start) && (
            <Circle
              center={[start.lat, start.lng]}
              pathOptions={{ color: BOUNDARY_COLOR, fillOpacity: 0.08 }}
              radius={start.radiusM}
            >
              <Tooltip>{start.label || "Start grid"}</Tooltip>
            </Circle>
          )}
          {isPlaced(end) && (
            <Circle
              center={[end.lat, end.lng]}
              pathOptions={{ color: BOUNDARY_COLOR, fillOpacity: 0.08 }}
              radius={end.radiusM}
            >
              <Tooltip>{end.label || "Arrival"}</Tooltip>
            </Circle>
          )}

          {placed.map((vehicle) => {
            const color = colorOf(vehicle);

            return (
              <CircleMarker
                center={[vehicle.lat as number, vehicle.lng as number]}
                key={vehicle.vehicleCode}
                pathOptions={{ color, fillColor: color, fillOpacity: 1 }}
                radius={7}
              >
                <Tooltip>
                  {vehicle.vehicleCode}
                  {vehicle.teamName ? ` · ${vehicle.teamName}` : ""} ·{" "}
                  {vehicle.done}/{vehicle.totalTasks || "?"}
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </Box>
      <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="caption">
        {placed.length === 0
          ? "No vehicle has reported a position yet."
          : `${placed.length} of ${vehicles.length} vehicles reporting. Green is running, amber a device issue, red a breakdown, blue finished.`}
      </Typography>
    </Box>
  );
}
