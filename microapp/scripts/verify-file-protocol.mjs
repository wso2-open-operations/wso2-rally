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

/**
 * Checks that `dist/` can load from a `file://` origin.
 *
 * The super app extracts this app's zip to an arbitrary directory and points a
 * WebView at it over `file://`. An absolute `/assets/…` resolves to the
 * filesystem root there and 404s — and the failure is a blank screen at the
 * start line, not a build error, so it is worth asserting mechanically.
 *
 * This checks what is checkable without a device: that every emitted reference
 * is relative, that the runtime config is in the bundle, and that the zip would
 * have `index.html` at its root. Actually rendering inside the WebView still
 * has to be done on a phone or simulator.
 *
 *   node scripts/verify-file-protocol.mjs
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const problems = [];
const checks = [];

const ok = (message) => checks.push(`  ok    ${message}`);
const bad = (message) => {
  problems.push(message);
  checks.push(`  FAIL  ${message}`);
};

if (!existsSync(DIST)) {
  console.error(`No ${DIST}/ — run \`npm run build\` first.`);
  process.exit(1);
}

const html = readFileSync(join(DIST, "index.html"), "utf8");

// 1. Every src/href the document pulls in must be relative.
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
const absolute = references.filter((reference) => reference.startsWith("/"));
if (absolute.length > 0) {
  bad(`absolute reference(s) in index.html: ${absolute.join(", ")} — set base: "./" in vite.config.ts`);
} else {
  ok(`all ${references.length} references in index.html are relative`);
}

// 2. The runtime config has to ship, or endpoints.ts throws on boot.
if (references.includes("./config.js")) {
  ok("index.html loads ./config.js relatively");
} else {
  bad('index.html does not reference "./config.js"');
}
if (existsSync(join(DIST, "config.js"))) {
  ok("config.js is in the build");
} else {
  bad("config.js is missing from dist/ — copy public/config.js.example to public/config.js before building");
}

// 3. index.html at the archive root: the WebView looks for it there, not in a
//    nested dist/ folder.
if (readdirSync(DIST).includes("index.html")) {
  ok("index.html sits at the root of what gets zipped");
} else {
  bad("index.html is not at the root of dist/");
}

// 4. Hash routing, because there is no server to rewrite unknown paths.
//    Detected by the DOM event hash history listens to: function names are
//    minified away, but the event name is a string literal and survives.
const bundle = readdirSync(join(DIST, "assets")).find((name) => name.endsWith(".js"));
if (bundle && readFileSync(join(DIST, "assets", bundle), "utf8").includes("hashchange")) {
  ok("the bundle listens for hashchange, so routing is hash-based");
} else {
  bad("no hashchange listener in the bundle — BrowserRouter cannot work from file://");
}

console.log(`file:// readiness of ${DIST}/\n${checks.join("\n")}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s). This build would not load in the super app's WebView.`);
  process.exit(1);
}
console.log("\nAll checks passed. Rendering inside the WebView still needs a device.");
