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

import { Box, Button, Typography } from "@wso2/oxygen-ui";
import { useNavigate } from "react-router";
import type { JSX } from "react";

/**
 * The not-found page.
 *
 * @returns {JSX.Element} The 404 page.
 */
export default function Error404Page(): JSX.Element {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        textAlign: "center",
      }}
    >
      <Typography variant="h3">404</Typography>
      <Typography variant="h6">We could not find that page</Typography>
      <Typography variant="body2" color="text.secondary">
        The link may be out of date, or the event may have been removed.
      </Typography>
      <Button variant="contained" onClick={() => void navigate("/events")}>
        Back to events
      </Button>
    </Box>
  );
}
