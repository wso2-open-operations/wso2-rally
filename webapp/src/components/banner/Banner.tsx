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

import { Alert, Box, IconButton } from "@wso2/oxygen-ui";
import { X } from "@wso2/oxygen-ui-icons-react";
import type { JSX } from "react";

export interface BannerProps {
  severity: "error" | "success" | "warning" | "info";
  message: string;
  onClose: () => void;
}

/**
 * The floating banner both the error and success providers render.
 *
 * Fixed to the bottom-right so it never displaces page content — an organizer
 * mid-edit should not have the form jump under their cursor.
 *
 * @param {BannerProps} props - Severity, message and dismiss handler.
 * @returns {JSX.Element} The banner.
 */
export default function Banner({
  severity,
  message,
  onClose,
}: BannerProps): JSX.Element {
  return (
    <Box
      sx={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: (theme) => theme.zIndex.snackbar,
        maxWidth: { xs: "calc(100vw - 48px)", sm: 480 },
      }}
    >
      <Alert
        severity={severity}
        variant="filled"
        action={
          <IconButton
            aria-label="Close notification"
            color="inherit"
            size="small"
            onClick={onClose}
          >
            <X size={16} />
          </IconButton>
        }
      >
        {message}
      </Alert>
    </Box>
  );
}
