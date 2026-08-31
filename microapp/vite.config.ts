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

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * The super app downloads this app as a zip, extracts it somewhere under its
 * document directory, and points a WebView at the result over `file://`.
 *
 * Two consequences are load-bearing:
 *
 * - `base: "./"` so every asset URL is relative. An absolute `/assets/…`
 *   resolves to the filesystem root inside a `file://` page and 404s.
 * - No PWA plugin and no service worker. There is nothing to install into, and
 *   a service worker cannot register from a `file://` origin anyway.
 *
 * Routing is `HashRouter` for the same reason: history routing needs a server
 * to rewrite unknown paths, and there is no server.
 */
export default defineConfig({
  base: "./",
  plugins: [react(), tsconfigPaths()],
  server: {
    // 3000 is the organizer web app; this one sits alongside it in development.
    port: 3001,
  },
  build: {
    // The WebView is a current WebKit/Chromium, so there is no reason to ship
    // transpiled-down output to it.
    target: "es2022",
    outDir: "dist",
  },
});
