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

import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type JSX } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useSessionGate } from "@hooks/useSessionGate";
import { emailFromToken, getSuperAppToken } from "@services/auth";
import { join } from "@services/session";
import { vehicles } from "@services/vehicles";
import type { JoinableVehicle } from "@/types/session.model";

/** Where a joined phone goes next. B2 decides from there. */
const AFTER_JOIN = "/lock";

const describeCar = (car: JoinableVehicle, showEvent: boolean): string =>
  `${car.code} · ${car.teamName}${showEvent ? ` — ${car.eventName}` : ""}`;

/**
 * B1 — which car are you in?
 *
 * The super app has already signed the crew member in, so this asks only that.
 * No name picker, no phone digits: the backend finds the person on the car's
 * crew list by the email in their sign-in. The list shows only the cars they
 * are on, so it is usually a single car, already chosen; joining still takes a
 * tap, because it binds this phone to that car for the whole rally.
 *
 * A phone that has already joined — or whose session came back after a reload
 * — never sees this screen; it goes straight on.
 */
export default function InitPage(): JSX.Element {
  const gate = useSessionGate();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState("");

  const signedInAs = useQuery({
    queryKey: ["superApp", "email"],
    queryFn: async () => emailFromToken(await getSuperAppToken()),
    enabled: gate === "anonymous",
  });
  const cars = useQuery({ ...vehicles.joinable(), enabled: gate === "anonymous" });
  const joining = useMutation({
    mutationFn: (vehicleId: string) => join(vehicleId),
    onSuccess: () => navigate(AFTER_JOIN, { replace: true }),
  });

  if (gate === "joined") {
    return <Navigate replace to={AFTER_JOIN} />;
  }

  const list = cars.data ?? [];
  // On one car — the usual case — it is already chosen.
  const selected = chosen || (list.length === 1 ? list[0].vehicleId : "");
  const showEvent = new Set(list.map((car) => car.eventId)).size > 1;
  const email = signedInAs.data ?? null;
  const loading = gate === "restoring" || cars.isPending || signedInAs.isPending;

  return (
    <Box component="main" sx={{ display: "flex", flexDirection: "column", gap: 3, p: 3, maxWidth: 480, mx: "auto" }}>
      <Stack spacing={0.5}>
        <Typography component="h1" variant="h5">
          System init
        </Typography>
        {email && (
          <>
            <Typography color="text.secondary" variant="body2">
              Signed in as
            </Typography>
            <Typography sx={{ fontWeight: 600, wordBreak: "break-all" }}>{email}</Typography>
          </>
        )}
      </Stack>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress aria-label="Finding your car" />
        </Box>
      )}

      {!loading && cars.isError && (
        <Alert
          action={
            <Button color="inherit" onClick={() => void cars.refetch()} size="small">
              Try again
            </Button>
          }
          severity="error"
        >
          {cars.error.message}
        </Alert>
      )}

      {!loading && cars.isSuccess && list.length === 0 && (
        // The usual cause is a typo on the crew list. Naming the address is
        // what lets the crew member spot it and tell an organizer.
        <Alert severity="info">
          {`${email ?? "Your account"} is not on the crew list of any car in a rally that is open to join. ` +
            "Ask an organizer to check the email on your car's crew list."}
        </Alert>
      )}

      {!loading && cars.isSuccess && list.length > 0 && (
        <Stack
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (selected) joining.mutate(selected);
          }}
          spacing={2}
        >
          <TextField
            helperText="Your crew is read from the roster for that vehicle"
            id="vehicle"
            label="Your vehicle"
            onChange={(event) => setChosen(event.target.value)}
            select
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            value={selected}
          >
            {!selected && (
              <option disabled value="">
                Select vehicle…
              </option>
            )}
            {list.map((car) => (
              <option key={car.vehicleId} value={car.vehicleId}>
                {describeCar(car, showEvent)}
              </option>
            ))}
          </TextField>

          {joining.isError && <Alert severity="error">{joining.error.message}</Alert>}

          <Button disabled={!selected || joining.isPending} size="large" type="submit" variant="contained">
            Join vehicle
          </Button>
        </Stack>
      )}
    </Box>
  );
}
