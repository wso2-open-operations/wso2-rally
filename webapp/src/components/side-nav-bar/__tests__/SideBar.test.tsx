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

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import SideBar from "@components/side-nav-bar/SideBar";

const renderSideBar = (initialPath = "/events") =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SideBar collapsed={false} />
    </MemoryRouter>,
  );

describe("SideBar", () => {
  // Rally lifecycle order, matching wireframes A1–A8. An alphabetical sort here
  // would put Debrief before Events and read as a random menu.
  it("renders the nav items in lifecycle order", () => {
    renderSideBar();

    const labels = screen.getAllByRole("link").map((link) => link.textContent);

    expect(labels).toEqual([
      "Events",
      "Routes",
      "Tasks",
      "Vehicles",
      "Live Monitor",
      "Leaderboard",
      "Debrief",
    ]);
  });

  it("links each item at its own top-level path", () => {
    renderSideBar();

    expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute(
      "href",
      "/events",
    );
    expect(screen.getByRole("link", { name: "Live Monitor" })).toHaveAttribute(
      "href",
      "/monitor",
    );
  });
});
