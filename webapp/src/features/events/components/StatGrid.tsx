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

import { Paper, Skeleton, Typography } from "@wso2/oxygen-ui";
import type { JSX } from "react";
import type { EventStats } from "@/types/event";

export interface StatGridProps {
  /** Events currently in the `active` status, across the whole portal. */
  activeCount: number;
  /** Counts for the event the dashboard is focused on; undefined before it loads. */
  stats: EventStats | undefined;
  isLoading: boolean;
}

interface StatCardProps {
  label: string;
  value: number;
  isLoading: boolean;
}

function StatCard({ label, value, isLoading }: StatCardProps): JSX.Element {
  return (
    <Paper
      variant="outlined"
      sx={{ flex: "1 1 140px", minWidth: 140, px: 2, py: 1.5 }}
    >
      <Typography color="text.secondary" variant="caption">
        {label}
      </Typography>
      {isLoading ? (
        <Skeleton variant="text" width={48} sx={{ fontSize: "1.75rem" }} />
      ) : (
        <Typography sx={{ fontWeight: 600, lineHeight: 1.2 }} variant="h5">
          {value}
        </Typography>
      )}
    </Paper>
  );
}

/**
 * The A1 headline cards: active events, and the focused event's fleet, crew and
 * task counts.
 *
 * @param {StatGridProps} props - Active count, per-event stats and loading state.
 * @returns {JSX.Element} The stat grid.
 */
export default function StatGrid({
  activeCount,
  stats,
  isLoading,
}: StatGridProps): JSX.Element {
  return (
    <>
      <StatCard label="Active" value={activeCount} isLoading={isLoading} />
      <StatCard label="Vehicles" value={stats?.vehicles ?? 0} isLoading={isLoading} />
      <StatCard label="Crews" value={stats?.crews ?? 0} isLoading={isLoading} />
      <StatCard label="Tasks" value={stats?.tasks ?? 0} isLoading={isLoading} />
    </>
  );
}
