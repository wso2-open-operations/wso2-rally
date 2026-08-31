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

import { type JSX } from "react";
import { Box, Typography } from "@wso2/oxygen-ui";
import { Circle, MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import { getMapConfig } from "@config/mapConfig";

export interface MapPickerProps {
  lat: number | null;
  lng: number | null;
  /** Drawn as a circle around the pin — this is the geofence the backend evaluates. */
  radiusM: number;
  /** Caption above the map, e.g. "Start grid geofence". */
  label: string;
  readOnly?: boolean;
  onChange: (position: { lat: number; lng: number }) => void;
  height?: number;
}

/**
 * Reports map clicks upward. react-leaflet's event hooks only work from inside
 * the MapContainer tree, so this has to be a child component rather than a
 * handler prop on the container.
 */
function ClickCapture({
  onChange,
}: {
  onChange: (position: { lat: number; lng: number }) => void;
}): null {
  useMapEvents({
    click: (event) => onChange({ lat: event.latlng.lat, lng: event.latlng.lng }),
  });

  return null;
}

/**
 * Click-to-place geofence picker (A2 start/end boundaries).
 *
 * OpenStreetMap tiles, no API key — the spec rules out keyed providers.
 *
 * @param {MapPickerProps} props - Current pin, radius, label and change handler.
 * @returns {JSX.Element} The map picker.
 */
export default function MapPicker({
  lat,
  lng,
  radiusM,
  label,
  readOnly = false,
  onChange,
  height = 280,
}: MapPickerProps): JSX.Element {
  const mapConfig = getMapConfig();
  const isPlaced = lat !== null && lng !== null;
  const center: [number, number] = isPlaced
    ? [lat, lng]
    : [mapConfig.defaultCenter.lat, mapConfig.defaultCenter.lng];

  return (
    <Box sx={{ width: "100%" }}>
      <Typography color="text.secondary" variant="caption">
        {label}
      </Typography>
      <Box
        sx={{
          height,
          mt: 0.5,
          borderRadius: 1,
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
          "& .leaflet-container": { height: "100%", width: "100%" },
        }}
      >
        <MapContainer
          center={center}
          zoom={isPlaced ? 15 : mapConfig.defaultZoom}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer attribution={mapConfig.attribution} url={mapConfig.tileUrl} />
          {!readOnly && <ClickCapture onChange={onChange} />}
          {isPlaced && (
            <>
              <Marker position={[lat, lng]} />
              {radiusM > 0 && (
                <Circle
                  center={[lat, lng]}
                  radius={radiusM}
                  pathOptions={{ color: "#ff7300", fillOpacity: 0.15 }}
                />
              )}
            </>
          )}
        </MapContainer>
      </Box>
      <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="caption">
        {readOnly
          ? isPlaced
            ? `${lat.toFixed(5)}, ${lng.toFixed(5)} · ${radiusM} m`
            : "No boundary placed"
          : isPlaced
            ? `${lat.toFixed(5)}, ${lng.toFixed(5)} · ${radiusM} m — click the map to move the pin`
            : "Click the map to place the boundary"}
      </Typography>
    </Box>
  );
}
