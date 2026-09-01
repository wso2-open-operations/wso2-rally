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

import { useState, type JSX } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@wso2/oxygen-ui";
import MapPicker from "@components/map-picker/MapPicker";
import { DEFAULT_BOUNDARY_RADIUS_M, type AddWaypointRequest, type Waypoint } from "@/types/route";

export interface WaypointDialogProps {
  /**
   * The waypoint being edited, a blank one (`id: ""`) for an add, or null when
   * the dialog is closed.
   */
  waypoint: Waypoint | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (body: AddWaypointRequest) => void;
}

interface Draft {
  label: string;
  lat: number | null;
  lng: number | null;
  radius: string;
}

const toDraft = (waypoint: Waypoint | null): Draft => ({
  label: waypoint?.label ?? "",
  // A brand-new waypoint has no position until the organizer clicks the map;
  // 0,0 would pass the backend's range check and quietly place it in the sea.
  lat: waypoint && waypoint.id !== "" ? waypoint.lat : null,
  lng: waypoint && waypoint.id !== "" ? waypoint.lng : null,
  radius: String(waypoint?.boundaryRadiusM ?? DEFAULT_BOUNDARY_RADIUS_M),
});

/**
 * Places or moves one waypoint: its label, its geofence radius, and where on
 * the map it sits.
 *
 * @param {WaypointDialogProps} props - The waypoint under edit and the handlers.
 * @returns {JSX.Element} The waypoint dialog.
 */
export default function WaypointDialog({
  waypoint,
  isSaving,
  onClose,
  onSave,
}: WaypointDialogProps): JSX.Element | null {
  if (!waypoint) {
    return null;
  }

  return (
    <WaypointForm
      isSaving={isSaving}
      // Remounts when a different waypoint is opened, so the form always starts
      // from that waypoint rather than from whatever was edited last.
      key={waypoint.id}
      onClose={onClose}
      onSave={onSave}
      waypoint={waypoint}
    />
  );
}

function WaypointForm({
  waypoint,
  isSaving,
  onClose,
  onSave,
}: WaypointDialogProps & { waypoint: Waypoint }): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => toDraft(waypoint));

  const radius = Number(draft.radius);
  const isPlaced = draft.lat !== null && draft.lng !== null;
  const isValid =
    draft.label.trim() !== "" && isPlaced && Number.isFinite(radius) && radius > 0;

  const handleSave = (): void => {
    if (!isValid || draft.lat === null || draft.lng === null) return;

    onSave({
      label: draft.label.trim(),
      lat: draft.lat,
      lng: draft.lng,
      boundaryRadiusM: Math.round(radius),
    });
  };

  return (
    <Dialog fullWidth maxWidth="sm" onClose={onClose} open>
      <DialogTitle>{waypoint.id !== "" ? "Edit waypoint" : "Add waypoint"}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 0.5 }}>
          <TextField
            autoFocus
            fullWidth
            label="Label"
            onChange={(changeEvent) =>
              setDraft((previous) => ({ ...previous, label: changeEvent.target.value }))
            }
            required
            size="small"
            value={draft.label}
          />
          <TextField
            fullWidth
            helperText="The geofence a car has to enter for this leg's tasks to unlock."
            label="Boundary radius (m)"
            onChange={(changeEvent) =>
              setDraft((previous) => ({ ...previous, radius: changeEvent.target.value }))
            }
            required
            size="small"
            type="number"
            value={draft.radius}
          />
          <MapPicker
            label="Waypoint position"
            lat={draft.lat}
            lng={draft.lng}
            onChange={({ lat, lng }) => setDraft((previous) => ({ ...previous, lat, lng }))}
            radiusM={Number.isFinite(radius) && radius > 0 ? radius : 0}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button disabled={isSaving} onClick={onClose} type="button">
          Cancel
        </Button>
        <Button
          disabled={!isValid || isSaving}
          onClick={handleSave}
          type="button"
          variant="contained"
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
