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

import { Box, Typography } from "@mui/material";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import type { JSX } from "react";
import RequireSession from "@components/layout/RequireSession";
import SessionLayout from "@components/layout/SessionLayout";
import CountdownPage from "@pages/CountdownPage";
import GeofenceLockPage from "@pages/GeofenceLockPage";
import InitPage from "@pages/InitPage";

/**
 * The B1–B10 screens land here as MA-4 onwards fill them in; the rest are
 * placeholders until their task builds them.
 *
 * B1 is the only screen open to a phone that has not joined. Everything else
 * sits behind `RequireSession`, which restores a stored session after a reload
 * before deciding, and otherwise sends the phone to B1 — and inside
 * `SessionLayout`, which holds the phone's one session socket for all of them.
 *
 * `HashRouter`, not `BrowserRouter`: the super app serves this from the
 * filesystem, and history routing needs a server to rewrite unknown paths.
 */
function Placeholder({ screen, title }: { screen: string; title: string }): JSX.Element {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 3, textAlign: "center" }}>
      <Typography color="text.secondary" variant="overline">
        {screen}
      </Typography>
      <Typography variant="h6">{title}</Typography>
      <Typography color="text.secondary" variant="body2">
        Not built yet.
      </Typography>
    </Box>
  );
}

export default function App(): JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<InitPage />} />
        <Route element={<RequireSession />}>
          <Route element={<SessionLayout />}>
            <Route path="/lock" element={<GeofenceLockPage />} />
            <Route path="/countdown" element={<CountdownPage />} />
            <Route path="/route" element={<Placeholder screen="B4" title="Next leg" />} />
            <Route path="/task/:taskId" element={<Placeholder screen="B7" title="Task" />} />
            <Route path="/rest" element={<Placeholder screen="B8" title="Mandatory rest" />} />
            <Route path="/arrival" element={<Placeholder screen="B9" title="Pearl Bay" />} />
            <Route path="/report" element={<Placeholder screen="B10" title="Report an issue" />} />
          </Route>
        </Route>
        {/* No 404 screen: a crew cannot type a URL, so an unknown hash is our
            own bug and the least-worst landing is the start of the flow. */}
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </HashRouter>
  );
}
