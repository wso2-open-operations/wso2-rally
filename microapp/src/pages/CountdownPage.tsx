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
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSessionEvents } from "@context/SessionSocketContext";
import { useNow } from "@hooks/useNow";
import { session } from "@services/session";
import { formatCountdown } from "@utils/countdown";

const NEXT = "/route";
const AFTER_FINISH = "/arrival";

/**
 * How long past the start a phone that has heard nothing lets the car go on
 * its own clock. The server's signal is what releases every car at once; this
 * only stops a phone whose socket was down at 09:00 — on an event with no
 * cipher, which GET /sessions/me would otherwise reveal — holding its crew at
 * the line for good.
 */
const CLOCK_FALLBACK_MS = 30_000;

/** How often to ask the server while the clock reads zero and no signal has come. */
const WAITING_REFETCH_MS = 5_000;

/**
 * B3 — the synchronised start.
 *
 * The countdown is the phone's clock and is for show. The release is the
 * server's: the `start_signal` frame, or the cipher in GET /sessions/me for a
 * phone that missed the frame. That is what makes every car start on the same
 * second, whatever its phone's clock says.
 *
 * Released, the cipher stays on screen until the crew moves on — it is the
 * first thing they have to decode, so it does not flash past.
 */
export default function CountdownPage(): JSX.Element {
  const socket = useSessionEvents();
  const now = useNow();
  const navigate = useNavigate();

  // Without the run there is nothing to count down to, so this reads the
  // previous render's answer to decide whether to keep asking.
  const run = useQuery({
    ...session.state(),
    refetchInterval: (query) => {
      const data = query.state.data;
      const startsAt = data?.startsAt?.getTime() ?? null;
      const released = socket.startSignal || socket.cipher !== null || (data?.cipher ?? null) !== null;

      return !released && startsAt !== null && Date.now() >= startsAt ? WAITING_REFETCH_MS : false;
    },
  });

  const status = run.data?.session.status;
  if (status === "active") {
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

  const startsAt = run.data.startsAt ?? socket.startsAt;
  const cipher = socket.cipher ?? run.data.cipher;
  const msLeft = startsAt ? startsAt.getTime() - now : null;
  const released = socket.startSignal || cipher !== null || (msLeft !== null && -msLeft >= CLOCK_FALLBACK_MS);
  const waiting = !released && msLeft !== null && msLeft <= 0;

  return (
    <Box component="main" sx={{ display: "flex", flexDirection: "column", gap: 3, p: 3, maxWidth: 480, mx: "auto" }}>
      <Stack spacing={0.5}>
        <Typography component="h1" variant="h5">
          {`${run.data.startTime} start`}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {`${run.data.vehicleCode} · ${run.data.teamName}`}
        </Typography>
      </Stack>

      <Stack spacing={1} sx={{ alignItems: "center", py: 2, textAlign: "center" }}>
        {released ? (
          <Typography component="h2" variant="h5">
            The rally has started
          </Typography>
        ) : (
          <>
            <Typography color="text.secondary" variant="overline">
              Auto-start countdown
            </Typography>
            {msLeft === null && (
              <Alert severity="warning" sx={{ textAlign: "left" }}>
                The start time could not be read. This screen unlocks when the start signal arrives.
              </Alert>
            )}
            {waiting && (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <CircularProgress size={20} />
                <Typography>Waiting for the start signal…</Typography>
              </Stack>
            )}
            {msLeft !== null && !waiting && (
              <Typography
                component="p"
                role="timer"
                sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}
                variant="h2"
              >
                {formatCountdown(msLeft)}
              </Typography>
            )}
          </>
        )}
      </Stack>

      {(!released || cipher !== null) && (
        <Paper sx={{ p: 2 }} variant="outlined">
          <Typography color="text.secondary" variant="overline">
            Route cipher
          </Typography>
          {cipher !== null ? (
            <Typography sx={{ fontFamily: "monospace", fontSize: "1.25rem", wordBreak: "break-word" }}>
              {cipher}
            </Typography>
          ) : (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <LockIcon aria-hidden color="disabled" fontSize="small" />
              <Typography color="text.secondary">Revealed on every car at the start.</Typography>
            </Stack>
          )}
        </Paper>
      )}

      {released && (
        <Button onClick={() => navigate(NEXT)} size="large" variant="contained">
          Go to the route
        </Button>
      )}
    </Box>
  );
}
