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
import { Box, Chip, LinearProgress, Paper, Typography } from "@wso2/oxygen-ui";
import type { VehicleLive } from "@features/monitor/monitorState";

export interface CompletionMatrixProps {
  vehicles: VehicleLive[];
}

/** Amber below two thirds, green above — the wireframe's chip colours. */
const chipColor = (done: number, total: number): "success" | "warning" | "default" => {
  if (total === 0) return "default";

  return done / total >= 2 / 3 ? "success" : "warning";
};

/**
 * A6's task-completion column: `done/totalTasks` per vehicle.
 *
 * Ordered by progress, not by code: during a rally the question is who is ahead
 * and who is stuck, and an alphabetical list buries both.
 *
 * @param {CompletionMatrixProps} props - The vehicles to rank.
 * @returns {JSX.Element} The completion matrix.
 */
export default function CompletionMatrix({
  vehicles,
}: CompletionMatrixProps): JSX.Element {
  // Routes carry different task counts, so raw `done` is not comparable across
  // courses — 10/100 would outrank 9/10. Rank on the fraction, and fall back to
  // the count then the code so the order is stable.
  const ratio = (vehicle: VehicleLive): number =>
    vehicle.totalTasks > 0 ? vehicle.done / vehicle.totalTasks : 0;
  // A car with no phone sharing location goes first: it is the one an organizer
  // may need to act on, and at the bottom of a long list it would be missed.
  const ranked = [...vehicles].sort(
    (left, right) =>
      Number(right.coverageLost) - Number(left.coverageLost) ||
      ratio(right) - ratio(left) ||
      right.done - left.done ||
      left.vehicleCode.localeCompare(right.vehicleCode),
  );

  return (
    <Paper
      sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1.5 }}
      variant="outlined"
    >
      <Typography color="text.secondary" variant="caption">
        Task completion
      </Typography>

      {ranked.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          No crews have started yet.
        </Typography>
      ) : (
        ranked.map((vehicle) => (
          <Box key={vehicle.vehicleCode} sx={{ display: "flex", flexDirection: "column" }}>
            <Box sx={{ alignItems: "center", display: "flex", gap: 1 }}>
              <Typography
                sx={{ flex: 1, fontFamily: "monospace" }}
                variant="caption"
              >
                {vehicle.vehicleCode}
              </Typography>
              {vehicle.coverageLost && (
                <Chip
                  color="error"
                  label="No location"
                  size="small"
                  title={
                    vehicle.lastReportAt
                      ? `No phone has reported since ${new Date(vehicle.lastReportAt).toLocaleTimeString()}`
                      : "No phone in this car has reported"
                  }
                  variant="outlined"
                />
              )}
              {vehicle.sessionStatus === "finished" && (
                <Chip color="primary" label="Finished" size="small" variant="outlined" />
              )}
              <Chip
                color={chipColor(vehicle.done, vehicle.totalTasks)}
                label={`${vehicle.done}/${vehicle.totalTasks || "?"}`}
                size="small"
              />
            </Box>
            <LinearProgress
              sx={{ borderRadius: 1, height: 4, mt: 0.5 }}
              value={
                vehicle.totalTasks > 0
                  ? Math.min(100, (vehicle.done / vehicle.totalTasks) * 100)
                  : 0
              }
              variant="determinate"
            />
          </Box>
        ))
      )}
    </Paper>
  );
}
