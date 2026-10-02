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

import { extendTheme } from "@mui/material/styles";

/**
 * The in-car theme.
 *
 * Sized for a phone in a cradle, read at a glance by someone driving or
 * navigating: a larger base size than a desktop app, 48px touch targets, and no
 * hover-only affordances.
 */
export const theme = extendTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#ff7300" },
        secondary: { main: "#1d4ed8" },
        success: { main: "#2f8f4e" },
        warning: { main: "#b25e00" },
        error: { main: "#d13438" },
      },
    },
    dark: {
      palette: {
        primary: { main: "#ff8c26" },
        secondary: { main: "#5b8bf7" },
        success: { main: "#4caf6d" },
        warning: { main: "#e0912b" },
        error: { main: "#f2555a" },
      },
    },
  },
  typography: {
    fontFamily: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"].join(","),
    fontSize: 15,
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 48 } },
    },
    MuiTextField: { defaultProps: { fullWidth: true } },
  },
});

export default theme;
