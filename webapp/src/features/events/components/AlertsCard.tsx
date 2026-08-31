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

import { Box, ButtonBase, Paper, Skeleton, Typography } from "@wso2/oxygen-ui";
import { TriangleAlert } from "@wso2/oxygen-ui-icons-react";
import type { JSX } from "react";

export interface AlertsCardProps {
  openAlerts: number;
  isLoading: boolean;
  /** Opens the live monitor, where the alerts can actually be worked. */
  onView: () => void;
}

/**
 * The A1 alerts card: unresolved breakdown and device issues across the fleet.
 *
 * Amber and clickable while alerts are open; inert once the count is zero,
 * since there would be nothing to look at.
 *
 * @param {AlertsCardProps} props - Count, loading state and the view handler.
 * @returns {JSX.Element} The alerts card.
 */
export default function AlertsCard({
  openAlerts,
  isLoading,
  onView,
}: AlertsCardProps): JSX.Element {
  const hasAlerts = openAlerts > 0;

  const body = (
    <Box sx={{ textAlign: "left", width: "100%" }}>
      <Box sx={{ alignItems: "center", display: "flex", gap: 0.5 }}>
        <TriangleAlert size={14} />
        <Typography variant="caption">Alerts</Typography>
      </Box>
      {isLoading ? (
        <Skeleton variant="text" width={48} sx={{ fontSize: "1.75rem" }} />
      ) : (
        <Typography sx={{ fontWeight: 600, lineHeight: 1.2 }} variant="h5">
          {openAlerts}
        </Typography>
      )}
      <Typography sx={{ display: "block", fontSize: 11 }} variant="caption">
        breakdown · phone
      </Typography>
    </Box>
  );

  return (
    <Paper
      variant="outlined"
      sx={{
        flex: "1 1 140px",
        minWidth: 140,
        borderColor: hasAlerts ? "warning.main" : "divider",
        color: hasAlerts ? "warning.main" : "text.secondary",
      }}
    >
      {hasAlerts ? (
        <ButtonBase
          aria-label={`View ${openAlerts} open alerts`}
          onClick={onView}
          sx={{ width: "100%", px: 2, py: 1.5, justifyContent: "flex-start" }}
        >
          {body}
        </ButtonBase>
      ) : (
        <Box sx={{ px: 2, py: 1.5 }}>{body}</Box>
      )}
    </Paper>
  );
}
