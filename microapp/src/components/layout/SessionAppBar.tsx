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

import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import { AppBar, IconButton, Stack, Toolbar, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { session } from "@services/session";
import AppBarStats, { type RunStats } from "./AppBarStats";

/**
 * The bar across every joined screen: which car this is, its score and
 * progress, and a way to report a vehicle problem that is never more than one
 * tap away.
 *
 * The numbers are the server's — the run's total and its task list — and are
 * left out rather than guessed while either is missing.
 */
export default function SessionAppBar(): JSX.Element {
  const navigate = useNavigate();
  const run = useQuery(session.state());
  const list = useQuery(session.tasks());

  const stats: RunStats | null =
    run.data && list.data
      ? {
          score: run.data.session.totalScore,
          done: list.data.filter((task) => task.status !== "pending").length,
          total: list.data.length,
        }
      : null;

  return (
    <AppBar color="default" elevation={0} position="sticky">
      <Toolbar sx={{ gap: 1 }} variant="dense">
        <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 700 }} variant="subtitle2">
            {run.data?.vehicleCode ?? ""}
          </Typography>
          <Typography color="text.secondary" noWrap variant="caption">
            {run.data?.teamName ?? ""}
          </Typography>
        </Stack>
        <AppBarStats stats={stats} />
        <IconButton aria-label="Report vehicle issue" color="warning" edge="end" onClick={() => navigate("/report")}>
          <ReportProblemIcon />
        </IconButton>
      </Toolbar>
    </AppBar>
  );
}
