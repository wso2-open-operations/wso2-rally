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

import { Box, CircularProgress } from "@mui/material";
import type { JSX } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useSessionGate } from "@hooks/useSessionGate";

/**
 * Guards every screen that needs a joined phone (B2–B10). A phone that has not
 * joined goes to B1; one whose session is still being restored after a reload
 * waits for it rather than being sent there by mistake.
 */
export default function RequireSession(): JSX.Element {
  const gate = useSessionGate();

  if (gate === "restoring") {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress aria-label="Resuming your rally" />
      </Box>
    );
  }
  if (gate === "anonymous") {
    return <Navigate replace to="/" />;
  }

  return <Outlet />;
}
