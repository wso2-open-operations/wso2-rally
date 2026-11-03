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

import { Stack, Typography } from "@mui/material";
import type { JSX } from "react";

export interface RunStats {
  score: number;
  /** Tasks settled — answered, or skipped by a shortcut. */
  done: number;
  total: number;
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Stack sx={{ alignItems: "flex-end", lineHeight: 1 }}>
      <Typography sx={{ fontSize: "0.625rem", letterSpacing: 1, opacity: 0.8 }} variant="overline">
        {label}
      </Typography>
      <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }} variant="body2">
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * SCORE and DONE, top right of every joined screen. Nothing at all without a
 * run: a zero on B1 would read as a score.
 */
export default function AppBarStats({ stats }: { stats: RunStats | null }): JSX.Element | null {
  if (!stats) return null;
  const { score, done, total } = stats;

  return (
    <Stack aria-label={`Score ${score}, ${done} of ${total} tasks done`} direction="row" role="group" spacing={2}>
      <Stat label="Score" value={String(score)} />
      <Stat label="Done" value={`${done}/${total}`} />
    </Stack>
  );
}
