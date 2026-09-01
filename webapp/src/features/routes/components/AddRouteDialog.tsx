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
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@wso2/oxygen-ui";

export interface AddRouteDialogProps {
  open: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}

/**
 * Names a new course. The two the rally runs are Inland and Wetlands, but the
 * spec keeps them configuration, so this asks rather than offering a fixed pair.
 *
 * @param {AddRouteDialogProps} props - Open state and the handlers.
 * @returns {JSX.Element} The add-route dialog.
 */
export default function AddRouteDialog({
  open,
  isSaving,
  onClose,
  onSave,
}: AddRouteDialogProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  // Mounted only while open, so every open starts from an empty field without
  // an effect having to clear the last one.
  return <AddRouteForm isSaving={isSaving} onClose={onClose} onSave={onSave} />;
}

function AddRouteForm({
  isSaving,
  onClose,
  onSave,
}: Omit<AddRouteDialogProps, "open">): JSX.Element {
  const [name, setName] = useState("");

  return (
    <Dialog fullWidth maxWidth="xs" onClose={onClose} open>
      <DialogTitle>Add route</DialogTitle>
      <DialogContent dividers>
        <DialogContentText sx={{ mb: 2 }} variant="body2">
          Vehicles are assigned to a route, and each route carries its own
          waypoints and geofences.
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          label="Route name"
          onChange={(changeEvent) => setName(changeEvent.target.value)}
          onKeyDown={(keyEvent) => {
            // Same guard as the Add button: without isSaving, holding Enter
            // fires a second POST, and the duplicate name comes back 409 —
            // an error banner for an action that already succeeded.
            if (keyEvent.key === "Enter" && name.trim() !== "" && !isSaving) {
              onSave(name.trim());
            }
          }}
          placeholder="Inland"
          required
          size="small"
          value={name}
        />
      </DialogContent>
      <DialogActions>
        <Button disabled={isSaving} onClick={onClose} type="button">
          Cancel
        </Button>
        <Button
          disabled={name.trim() === "" || isSaving}
          onClick={() => onSave(name.trim())}
          type="button"
          variant="contained"
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
