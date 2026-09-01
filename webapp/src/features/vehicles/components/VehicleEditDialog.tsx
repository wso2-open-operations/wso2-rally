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

import { useState, type FormEvent, type JSX } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  TextField,
} from "@wso2/oxygen-ui";
import CrewEditor from "@features/vehicles/components/CrewEditor";
import type { RallyRoute } from "@/types/route";
import {
  MIN_PHONE_DIGITS,
  VEHICLE_STATUS_META,
  VEHICLE_TYPES,
  digitCount,
  type CreateVehicleRequest,
  type CrewMember,
  type Vehicle,
  type VehicleStatus,
} from "@/types/vehicle";

export interface VehicleEditDialogProps {
  /** The vehicle under edit, a blank one (`id: ""`) to add, or null when closed. */
  vehicle: Vehicle | null;
  routes: RallyRoute[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (body: CreateVehicleRequest & { status?: VehicleStatus }) => void;
}

interface FieldErrors {
  code?: string;
  teamName?: string;
  crew?: string;
}

/**
 * Adds or edits one vehicle and its crew.
 *
 * @param {VehicleEditDialogProps} props - The vehicle under edit and its handlers.
 * @returns {JSX.Element | null} The dialog, or null when closed.
 */
export default function VehicleEditDialog({
  vehicle,
  routes,
  isSaving,
  onClose,
  onSave,
}: VehicleEditDialogProps): JSX.Element | null {
  if (!vehicle) {
    return null;
  }

  return (
    <VehicleForm
      isSaving={isSaving}
      // Remounts when a different vehicle is opened, so the form always starts
      // from that vehicle rather than from whatever was edited last.
      key={vehicle.id}
      onClose={onClose}
      onSave={onSave}
      routes={routes}
      vehicle={vehicle}
    />
  );
}

function VehicleForm({
  vehicle,
  routes,
  isSaving,
  onClose,
  onSave,
}: VehicleEditDialogProps & { vehicle: Vehicle }): JSX.Element {
  const [form, setForm] = useState({
    code: vehicle.code,
    teamName: vehicle.teamName,
    vehicleType: vehicle.vehicleType,
    contactNumber: vehicle.contactNumber,
    routeId: vehicle.routeId,
    status: vehicle.status,
  });
  const [crew, setCrew] = useState<CrewMember[]>(vehicle.crew);
  const [errors, setErrors] = useState<FieldErrors>({});

  const isNew = vehicle.id === "";

  const validate = (): FieldErrors => {
    const found: FieldErrors = {};
    if (form.code.trim() === "") {
      found.code = "A vehicle code is required.";
    }
    if (form.teamName.trim() === "") {
      found.teamName = "A team name is required.";
    }

    // The backend rejects the whole vehicle over one bad crew row, so catching
    // it here saves the organizer a round trip that discards their typing.
    const incomplete = crew.findIndex(
      (member) =>
        member.name.trim() === "" || digitCount(member.phoneNumber) < MIN_PHONE_DIGITS,
    );
    if (incomplete !== -1) {
      found.crew = `Crew member ${incomplete + 1} needs a name and a phone number of at least ${MIN_PHONE_DIGITS} digits.`;
    }

    return found;
  };

  const handleSubmit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault();

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }

    onSave({
      code: form.code.trim(),
      teamName: form.teamName.trim(),
      vehicleType: form.vehicleType.trim(),
      contactNumber: form.contactNumber.trim(),
      routeId: form.routeId,
      // Always the whole roster: a supplied crew replaces the previous one
      // wholesale, so a partial list would delete the members left out.
      crew: crew.map((member) => ({
        name: member.name.trim(),
        phoneNumber: member.phoneNumber.trim(),
        role: member.role,
        originCountry: member.originCountry.trim(),
      })),
      ...(isNew ? {} : { status: form.status }),
    });
  };

  return (
    <Dialog fullWidth maxWidth="md" onClose={onClose} open>
      {/* noValidate: the fields are marked required so the asterisks show, but
          the browser's own blocking would pre-empt `validate` and replace its
          messages with a native tooltip that cannot explain the phone rule. */}
      <form noValidate onSubmit={handleSubmit}>
        <DialogTitle>{isNew ? "Add vehicle" : `Edit ${vehicle.code}`}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 0.5 }}>
            {errors.crew && <Alert severity="warning">{errors.crew}</Alert>}

            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
              <TextField
                autoFocus
                error={Boolean(errors.code)}
                helperText={errors.code}
                label="Vehicle code"
                onChange={(changeEvent) =>
                  setForm((previous) => ({ ...previous, code: changeEvent.target.value }))
                }
                placeholder="PKT-001"
                required
                size="small"
                sx={{ flex: "1 1 160px" }}
                value={form.code}
              />
              <TextField
                error={Boolean(errors.teamName)}
                helperText={errors.teamName}
                label="Team name"
                onChange={(changeEvent) =>
                  setForm((previous) => ({
                    ...previous,
                    teamName: changeEvent.target.value,
                  }))
                }
                required
                size="small"
                sx={{ flex: "2 1 220px" }}
                value={form.teamName}
              />
            </Box>

            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
              <TextField
                label="Type"
                onChange={(changeEvent) =>
                  setForm((previous) => ({
                    ...previous,
                    vehicleType: changeEvent.target.value,
                  }))
                }
                select
                size="small"
                sx={{ flex: "1 1 140px" }}
                value={form.vehicleType}
              >
                <MenuItem value="">
                  <em>Unspecified</em>
                </MenuItem>
                {VEHICLE_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>
                    {type}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                helperText="Reached first when a car goes quiet."
                label="Contact number"
                onChange={(changeEvent) =>
                  setForm((previous) => ({
                    ...previous,
                    contactNumber: changeEvent.target.value,
                  }))
                }
                size="small"
                sx={{ flex: "1 1 180px" }}
                value={form.contactNumber}
              />
              <TextField
                label="Route"
                onChange={(changeEvent) =>
                  setForm((previous) => ({
                    ...previous,
                    routeId: changeEvent.target.value,
                  }))
                }
                select
                size="small"
                sx={{ flex: "1 1 160px" }}
                value={form.routeId}
              >
                <MenuItem value="">
                  <em>Unassigned</em>
                </MenuItem>
                {routes.map((route) => (
                  <MenuItem key={route.id} value={route.id}>
                    {route.name}
                  </MenuItem>
                ))}
              </TextField>
              {!isNew && (
                <TextField
                  helperText="Alerts move this on their own during the rally."
                  label="Status"
                  onChange={(changeEvent) =>
                    setForm((previous) => ({
                      ...previous,
                      status: changeEvent.target.value as VehicleStatus,
                    }))
                  }
                  select
                  size="small"
                  sx={{ flex: "1 1 150px" }}
                  value={form.status}
                >
                  {Object.entries(VEHICLE_STATUS_META).map(([status, meta]) => (
                    <MenuItem key={status} value={status}>
                      {meta.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Box>

            <Divider />

            <CrewEditor crew={crew} disabled={isSaving} onChange={setCrew} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button disabled={isSaving} onClick={onClose} type="button">
            Cancel
          </Button>
          <Button disabled={isSaving} type="submit" variant="contained">
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
