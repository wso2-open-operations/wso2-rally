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
import { Box, Chip, Paper, Typography } from "@wso2/oxygen-ui";
import { TriangleAlert } from "@wso2/oxygen-ui-icons-react";
import type { RallyAlert } from "@/types/monitor";

/** Human labels for an alert kind. */
const ALERT_LABELS: Record<string, string> = {
  breakdown: "Breakdown",
  device_issue: "Device issue",
  other: "Other",
};

export interface AlertsStripProps {
  alerts: RallyAlert[];
  /** The event's open-alert count, which includes any raised before this page opened. */
  openAlerts: number;
}

/**
 * The live alerts strip.
 *
 * `openAlerts` is the event's whole count, from the snapshot; `alerts` is only
 * what arrived over the socket since the page opened. Showing both is
 * deliberate — an organizer arriving mid-rally needs to know there are five
 * open problems even though this strip has seen one.
 *
 * @param {AlertsStripProps} props - The recent alerts and the open count.
 * @returns {JSX.Element} The alerts strip.
 */
export default function AlertsStrip({
  alerts,
  openAlerts,
}: AlertsStripProps): JSX.Element {
  return (
    <Paper
      sx={{
        borderColor: openAlerts > 0 ? "warning.main" : "divider",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        p: 1.5,
      }}
      variant="outlined"
    >
      <Box sx={{ alignItems: "center", display: "flex", gap: 1 }}>
        <TriangleAlert size={16} />
        <Typography sx={{ flex: 1 }} variant="subtitle2">
          Alerts
        </Typography>
        <Chip
          color={openAlerts > 0 ? "warning" : "default"}
          label={`${openAlerts} open`}
          size="small"
        />
      </Box>

      {alerts.length === 0 ? (
        <Typography color="text.secondary" variant="caption">
          {openAlerts > 0
            ? "Nothing new since this page opened — the open ones are on the events dashboard."
            : "No problems reported."}
        </Typography>
      ) : (
        alerts.map((alert) => (
          <Box key={alert.id} sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
            <Chip
              color={alert.resolvedAt ? "default" : "warning"}
              label={ALERT_LABELS[alert.type] ?? alert.type}
              size="small"
              variant={alert.resolvedAt ? "outlined" : "filled"}
            />
            <Typography
              sx={{
                flex: 1,
                textDecoration: alert.resolvedAt ? "line-through" : "none",
              }}
              variant="caption"
            >
              {alert.note || "No detail given"}
            </Typography>
          </Box>
        ))
      )}
    </Paper>
  );
}
