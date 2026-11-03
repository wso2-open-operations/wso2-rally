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

import { describe, expect, it } from "vitest";
import { initialTileHealth, tileHealthReducer, type TileHealth } from "./tileHealth";

const run = (...events: ("errored" | "loaded")[]): TileHealth => events.reduce(tileHealthReducer, initialTileHealth);

describe("tileHealthReducer", () => {
  it("starts out assuming the imagery is there", () => {
    expect(initialTileHealth.available).toBe(true);
  });

  // One failed tile is one missing square, not an outage.
  it("survives a single failed tile", () => {
    expect(run("errored").available).toBe(true);
  });

  it("calls the imagery unavailable after two failures in a row", () => {
    expect(run("errored", "errored").available).toBe(false);
  });

  it("does not count failures a loaded tile came between", () => {
    expect(run("errored", "loaded", "errored").available).toBe(true);
  });

  // Coverage coming back must heal the screen without a reload.
  it("restores the imagery on the next tile that loads", () => {
    expect(run("errored", "errored", "errored", "loaded").available).toBe(true);
  });

  it("returns the same state when nothing changes", () => {
    const healthy = run("loaded");

    expect(tileHealthReducer(healthy, "loaded")).toBe(healthy);
  });
});
