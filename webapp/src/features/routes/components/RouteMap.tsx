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
  Polyline,
  Tooltip,
  TileLayer,
  useMap,
} from "react-leaflet";
import { getMapConfig } from "@config/mapConfig";
import type { Boundary } from "@/types/event";
import type { Waypoint } from "@/types/route";

/** The waypoint geofences. Amber, matching the picker's circles in A2. */
const WAYPOINT_COLOR = "#ff7300";
/** The event's start and end boundaries, which A2 owns and A3 only shows. */
const BOUNDARY_COLOR = "#2f8f4e";
const SELECTED_COLOR = "#1d4ed8";

export interface RouteMapProps {
  waypoints: Waypoint[];
  selectedId: string | null;
  /** The event's start grid, drawn for context; not editable here. */
  start?: Boundary;
  /** The event's arrival boundary, drawn for context; not editable here. */
  end?: Boundary;
  onSelect: (waypointId: string) => void;
  height?: number;
}

const isPlaced = (boundary?: Boundary): boundary is Boundary & { lat: number; lng: number } =>
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


/**
 * The A3 course overview: every waypoint with its geofence, joined in driving
 * order, between the event's start and end boundaries.
 *
 * Read-only by design. Positions are edited in the waypoint dialog, where a
 * click means "put it here"; on this map a click means "select that leg", and
 * one gesture cannot be both without an organizer nudging a geofence by
 * accident.
 *
 * @param {RouteMapProps} props - Waypoints, the selection, and the event boundaries.
 * @returns {JSX.Element} The route map.
 */
export default function RouteMap({
  waypoints,
  selectedId,
  start,
  end,
  onSelect,
  height = 460,
}: RouteMapProps): JSX.Element {
  const mapConfig = getMapConfig();
  const line = waypoints.map((waypoint): [number, number] => [waypoint.lat, waypoint.lng]);
  const first = waypoints[0];
  const center: [number, number] = first
    ? [first.lat, first.lng]
    : isPlaced(start)
      ? [start.lat, start.lng]
      : [mapConfig.defaultCenter.lat, mapConfig.defaultCenter.lng];
  const zoom = waypoints.length > 0 ? 12 : mapConfig.defaultZoom;
  // Switching route replaces the waypoints, so the first one's id is what says
  // "this is a different course now".
  const anchorKey = first?.id ?? (isPlaced(start) ? "start" : "default");

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
          zoom={zoom}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer attribution={mapConfig.attribution} url={mapConfig.tileUrl} />
          <SyncView anchorKey={anchorKey} center={center} zoom={zoom} />

          {isPlaced(start) && (
            <Circle
              center={[start.lat, start.lng]}
              pathOptions={{ color: BOUNDARY_COLOR, fillOpacity: 0.1 }}
              radius={start.radiusM}
            >
              <Tooltip>{start.label || "Start grid"}</Tooltip>
            </Circle>
          )}
          {isPlaced(end) && (
            <Circle
              center={[end.lat, end.lng]}
              pathOptions={{ color: BOUNDARY_COLOR, fillOpacity: 0.1 }}
              radius={end.radiusM}
            >
              <Tooltip>{end.label || "Arrival"}</Tooltip>
            </Circle>
          )}

          {line.length > 1 && (
            <Polyline pathOptions={{ color: WAYPOINT_COLOR, weight: 3 }} positions={line} />
          )}

          {waypoints.map((waypoint, index) => {
            const isSelected = waypoint.id === selectedId;
            const color = isSelected ? SELECTED_COLOR : WAYPOINT_COLOR;

            return (
              <Box component="span" key={waypoint.id}>
                <Circle
                  center={[waypoint.lat, waypoint.lng]}
                  pathOptions={{ color, fillOpacity: isSelected ? 0.3 : 0.15 }}
                  radius={waypoint.boundaryRadiusM}
                />
                <CircleMarker
                  center={[waypoint.lat, waypoint.lng]}
                  eventHandlers={{ click: () => onSelect(waypoint.id) }}
                  pathOptions={{ color, fillColor: color, fillOpacity: 1 }}
                  radius={isSelected ? 8 : 6}
                >
                  <Tooltip>
                    {index + 1}. {waypoint.label} · {waypoint.boundaryRadiusM} m
                  </Tooltip>
                </CircleMarker>
              </Box>
            );
          })}
        </MapContainer>
      </Box>
      <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="caption">
        {waypoints.length === 0
          ? "No waypoints on this route yet."
          : "Click a waypoint to open its settings. Green rings are the event's start and arrival boundaries, set in event setup."}
      </Typography>
    </Box>
  );
}
