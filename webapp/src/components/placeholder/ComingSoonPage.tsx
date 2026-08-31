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

import { Box, Paper, Typography } from "@wso2/oxygen-ui";
import { Hammer } from "@wso2/oxygen-ui-icons-react";
import type { JSX } from "react";

export interface ComingSoonPageProps {
  title: string;
  /** The wireframe screen this page will implement, e.g. "A3". */
  screen: string;
}

/**
 * Placeholder for a navigation item whose feature is not built yet.
 *
 * The sidebar lists all seven organizer features because that is the shape of
 * the product; linking an unbuilt one at a dead 404 would read as a bug.
 *
 * @param {ComingSoonPageProps} props - Feature title and wireframe screen id.
 * @returns {JSX.Element} The placeholder page.
 */
export default function ComingSoonPage({
  title,
  screen,
}: ComingSoonPageProps): JSX.Element {
  return (
    <Box sx={{ width: "100%" }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        {title}
      </Typography>
      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1.5,
          py: 8,
          px: 3,
          textAlign: "center",
        }}
      >
        <Hammer size={32} />
        <Typography variant="subtitle1">Not built yet</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {title} is wireframe {screen} and lands in a later increment. Event
          setup is available now under Events.
        </Typography>
      </Paper>
    </Box>
  );
}
