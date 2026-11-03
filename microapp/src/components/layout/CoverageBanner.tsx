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

import { Alert, AlertTitle, Button } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";
import { useReporter } from "@context/LocationReporterContext";
import { useSessionEvents } from "@context/SessionSocketContext";
import { session } from "@services/session";

/**
 * Shown on every joined screen while no phone in the car is reporting.
 *
 * The driver's phone stops reporting in Google Maps, so the car stays covered
 * only if a passenger's phone keeps going — otherwise a checkpoint passed in the
 * meantime unlocks a task the crew can no longer do. The banner asks for what a
 * passenger can actually do, and offers to start sharing from this phone.
 *
 * The latest coverage frame wins; until one arrives — a phone that opened
 * mid-outage missed it — the session state's `coverageLost` stands in. Both
 * use the server's 30-second rule, so they agree.
 */
export default function CoverageBanner(): JSX.Element | null {
  const socket = useSessionEvents();
  const reporter = useReporter();
  const run = useQuery(session.state());

  const lost = socket.coverageLost ?? run.data?.coverageLost ?? false;
  if (!lost) return null;

  return (
    <Alert
      action={
        reporter.sharing ? undefined : (
          <Button color="inherit" onClick={reporter.start} size="small">
            Share from this phone
          </Button>
        )
      }
      severity="warning"
      square
    >
      <AlertTitle>No phone in this car is reporting its position</AlertTitle>
      Keep the rally app open with location on — a phone locked in a pocket stops reporting, and a checkpoint passed
      meanwhile may not unlock.
    </Alert>
  );
}
