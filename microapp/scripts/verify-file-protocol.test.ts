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

// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./verify-file-protocol.mjs", import.meta.url));

const RELEASE_CONFIG = `window.config = {
  BACKEND_BASE_URL: "https://rally.example",
  IS_MICROAPP: true,
  DEV_SUPER_APP_TOKEN: "",
};`;

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

/** A dist/ that passes every file:// check, shipping the given runtime config. */
function buildWith(config: string): string {
  const root = mkdtempSync(join(tmpdir(), "rally-verify-"));
  roots.push(root);
  mkdirSync(join(root, "dist", "assets"), { recursive: true });
  writeFileSync(
    join(root, "dist", "index.html"),
    '<script src="./config.js"></script><script type="module" src="./assets/index.js"></script>',
  );
  writeFileSync(join(root, "dist", "assets", "index.js"), 'addEventListener("hashchange", () => {});');
  writeFileSync(join(root, "dist", "config.js"), config);

  return root;
}

const verify = (root: string) => spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: "utf8" });

describe("verify-file-protocol", () => {
  it("passes a release build", () => {
    const run = verify(buildWith(RELEASE_CONFIG));

    expect(run.status, run.stdout + run.stderr).toBe(0);
  });

  // `npm run package` zips config.js as built. A developer's token in it would
  // reach every phone, and every crew would join as that developer.
  it("fails a build that ships a developer's token", () => {
    const run = verify(
      buildWith(RELEASE_CONFIG.replace('DEV_SUPER_APP_TOKEN: ""', 'DEV_SUPER_APP_TOKEN: "a.dev.jwt"')),
    );

    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/FAIL .*DEV_SUPER_APP_TOKEN/);
  });

  // Without IS_MICROAPP the app never asks the super app for a token.
  it("fails a browser-development config", () => {
    const run = verify(buildWith(RELEASE_CONFIG.replace("IS_MICROAPP: true", "IS_MICROAPP: false")));

    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/FAIL .*IS_MICROAPP/);
  });

  it("wants the boolean true, not the string", () => {
    const run = verify(buildWith(RELEASE_CONFIG.replace("IS_MICROAPP: true", 'IS_MICROAPP: "true"')));

    expect(run.status).toBe(1);
  });

  // config.js.example names both keys in its comments; only the values count.
  it("reads the values, not comments that mention them", () => {
    const run = verify(
      buildWith(`// Never set DEV_SUPER_APP_TOKEN here. IS_MICROAPP: false is for the browser.\n${RELEASE_CONFIG}`),
    );

    expect(run.status, run.stdout + run.stderr).toBe(0);
  });

  it("fails a config.js that sets no window.config", () => {
    const run = verify(buildWith("var config = {};"));

    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/FAIL .*window\.config/);
  });
});
