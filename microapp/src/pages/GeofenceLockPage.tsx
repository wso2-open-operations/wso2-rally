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
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

import LockIcon from "@mui/icons-material/Lock";
import PlaceIcon from "@mui/icons-material/Place";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";
import { Navigate } from "react-router-dom";
import { useGeofence } from "@hooks/useGeofence";
import { describePositionFailure } from "@sensors/position";
import { session } from "@services/session";
import { formatDistance } from "@utils/geo";

/** Where a car inside the grid goes next. B3 decides from there. */
const NEXT = "/countdown";
const AFTER_FINISH = "/arrival";

/**
 * B2 — get the car onto the start grid.
 *
 * The screen stays locked until this phone's position falls inside the start
 * geofence, then moves on to the countdown by itself. There is no button to
 * press and no facilitator to wave the car through; the distance readout is
 * the only thing the crew needs.
 *
 * The check here is for the crew's benefit only. It mirrors the server's
 * point-in-radius test so the two agree, but nothing the server decides waits
 * on it.
 *
 * A car that has already left the grid — a phone rejoining mid-rally lands
 * here from B1 — goes straight on rather than being sent back to the start.
 */
export default function GeofenceLockPage(): JSX.Element {
  const run = useQuery(session.state());
  const grid = run.data?.startCircle ?? null;
  const placed = grid?.placed === true;
  const fence = useGeofence(placed ? grid : null, grid?.radiusM ?? 0);
  const status = run.data?.session.status;

  if (status === "active" || (status === "bound" && fence.inside)) {
    return <Navigate replace to={NEXT} />;
  }
  if (status === "finished") {
    return <Navigate replace to={AFTER_FINISH} />;
  }

  if (run.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress aria-label="Loading your run" />
      </Box>
    );
  }

  if (run.isError) {
    return (
      <Box component="main" sx={{ p: 3, maxWidth: 480, mx: "auto" }}>
        <Alert
          action={
            <Button color="inherit" onClick={() => void run.refetch()} size="small">
              Try again
            </Button>
          }
          severity="error"
        >
          {run.error.message}
        </Alert>
      </Box>
    );
  }

  const { position, distanceM, failure } = fence;
  const toGo = distanceM !== null && grid ? Math.max(0, distanceM - grid.radiusM) : null;

  return (
    <Box component="main" sx={{ display: "flex", flexDirection: "column", gap: 3, p: 3, maxWidth: 480, mx: "auto" }}>
      <Stack spacing={0.5}>
        <Typography component="h1" variant="h5">
          Start grid
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {`${run.data.vehicleCode} · ${run.data.teamName}`}
        </Typography>
      </Stack>

      <Stack spacing={1} sx={{ alignItems: "center", py: 2, textAlign: "center" }}>
        <PlaceIcon aria-hidden color="primary" sx={{ fontSize: 48 }} />
        <Typography component="h2" variant="h6">
          Move into the start grid
        </Typography>

        {placed && !failure && (
          <Typography color="text.secondary">
            {toGo === null ? "Finding your position…" : `Interface locked · ${formatDistance(toGo)} away`}
          </Typography>
        )}

        {position && (
          <Typography color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }} variant="caption">
            {`GPS ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · accuracy ±${Math.round(position.accuracy)} m`}
          </Typography>
        )}
      </Stack>

      {!placed && (
        // Publishing an event requires the pin, so this is an organizer's slip.
        <Alert severity="warning">
          The start grid has not been placed on the map yet. Ask an organizer to place it; this screen unlocks once the
          car is inside it.
        </Alert>
      )}

      {failure && (
        <Alert
          action={
            <Button color="inherit" onClick={fence.retry} size="small">
              Try again
            </Button>
          }
          severity="warning"
        >
          {describePositionFailure(failure)}
        </Alert>
      )}

      <Button disabled size="large" startIcon={<LockIcon />} variant="contained">
        Locked until inside the grid
      </Button>
    </Box>
  );
}
