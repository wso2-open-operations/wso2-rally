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
import { Box, CircularProgress, IconButton, Tooltip } from "@wso2/oxygen-ui";
import { Download, Upload } from "@wso2/oxygen-ui-icons-react";

export interface FleetToolbarProps {
  isImporting: boolean;
  isExporting: boolean;
  /** False when the fleet is empty; the file would carry only a header row. */
  canExport: boolean;
  onImport: () => void;
  onExport: () => void;
}

/**
 * The icon-only CSV pair from the A5 wireframe.
 *
 * The buttons carry no caption, so their accessible name is their *only* name —
 * it comes from `aria-label` rather than from the tooltip, which assistive
 * technology and a keyboard user cannot rely on.
 *
 * @param {FleetToolbarProps} props - Transfer state and the handlers.
 * @returns {JSX.Element} The import/export controls.
 */
export default function FleetToolbar({
  isImporting,
  isExporting,
  canExport,
  onImport,
  onExport,
}: FleetToolbarProps): JSX.Element {
  const isBusy = isImporting || isExporting;

  return (
    <Box sx={{ display: "flex", gap: 0.5 }}>
      {/* The spans are not decoration: a disabled button fires no events, so
          Tooltip has nothing to listen to without a wrapper. */}
      <Tooltip title="Import from CSV">
        <Box component="span">
          <IconButton
            aria-label="Import from CSV"
            disabled={isBusy}
            onClick={onImport}
            size="small"
          >
            {isImporting ? <CircularProgress size={16} /> : <Upload size={18} />}
          </IconButton>
        </Box>
      </Tooltip>
      <Tooltip title={canExport ? "Export to CSV" : "Nothing to export yet"}>
        <Box component="span">
          <IconButton
            aria-label="Export to CSV"
            disabled={isBusy || !canExport}
            onClick={onExport}
            size="small"
          >
            {isExporting ? <CircularProgress size={16} /> : <Download size={18} />}
          </IconButton>
        </Box>
      </Tooltip>
    </Box>
  );
}
