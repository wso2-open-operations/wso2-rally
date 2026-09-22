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

import { useRef, useState, type JSX } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Typography,
} from "@wso2/oxygen-ui";
import { Upload } from "@wso2/oxygen-ui-icons-react";
import { VEHICLE_CSV_HEADER, VEHICLE_CSV_TEMPLATE, downloadBlob } from "@utils/csv";

export interface ImportCsvDialogProps {
  open: boolean;
  isImporting: boolean;
  onClose: () => void;
  onImport: (file: File) => void;
}

/**
 * Picks the provisioning spreadsheet and explains its shape before anything is
 * uploaded.
 *
 * The column order is fixed and a mis-shaped file is rejected whole, so the
 * dialog states the header and offers a template rather than letting an
 * organizer discover the format from a validation error.
 *
 * @param {ImportCsvDialogProps} props - Open state and the handlers.
 * @returns {JSX.Element | null} The import dialog, or null when closed.
 */
export default function ImportCsvDialog({
  open,
  isImporting,
  onClose,
  onImport,
}: ImportCsvDialogProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return <ImportForm isImporting={isImporting} onClose={onClose} onImport={onImport} />;
}

function ImportForm({
  isImporting,
  onClose,
  onImport,
}: Omit<ImportCsvDialogProps, "open">): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog fullWidth maxWidth="sm" onClose={onClose} open>
      <DialogTitle>Import vehicles from CSV</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Alert severity="info">
            The import is all or nothing: if any row is rejected, no vehicle is
            created and the fleet is left exactly as it was.
          </Alert>

          <Box>
            <Typography variant="subtitle2">Columns, in this order</Typography>
            <Typography
              component="pre"
              sx={{
                bgcolor: "action.hover",
                borderRadius: 1,
                fontFamily: "monospace",
                mt: 0.5,
                overflowX: "auto",
                p: 1,
              }}
              variant="caption"
            >
              {VEHICLE_CSV_HEADER.join(",")}
            </Typography>
            <Typography color="text.secondary" variant="caption">
              <code>route_name</code> matches a route of this event by name.{" "}
              <code>crew_names</code> holds <code>Name:email:phone</code> entries
              joined by <code>|</code>. All three are required: the WSO2 email is
              how the in-car app recognises that person, and the phone is how you
              reach the car if it goes quiet.
            </Typography>
          </Box>

          <Link
            component="button"
            onClick={() =>
              downloadBlob(
                new Blob([VEHICLE_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }),
                "vehicles-template.csv",
              )
            }
            type="button"
            underline="hover"
            variant="body2"
          >
            Download a one-row template
          </Link>

          <Box sx={{ alignItems: "center", display: "flex", gap: 1.5 }}>
            <Button
              disabled={isImporting}
              onClick={() => inputRef.current?.click()}
              startIcon={<Upload size={16} />}
              type="button"
              variant="outlined"
            >
              Choose file
            </Button>
            <Typography color="text.secondary" variant="body2">
              {file ? file.name : "No file chosen"}
            </Typography>
            <input
              accept=".csv,text/csv"
              aria-label="Vehicle CSV file"
              hidden
              onChange={(changeEvent) => setFile(changeEvent.target.files?.[0] ?? null)}
              ref={inputRef}
              type="file"
            />
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button disabled={isImporting} onClick={onClose} type="button">
          Cancel
        </Button>
        <Button
          disabled={!file || isImporting}
          onClick={() => file && onImport(file)}
          type="button"
          variant="contained"
        >
          Import
        </Button>
      </DialogActions>
    </Dialog>
  );
}
