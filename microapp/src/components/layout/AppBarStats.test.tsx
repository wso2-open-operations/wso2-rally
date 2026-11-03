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

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppBarStats from "./AppBarStats";

describe("AppBarStats", () => {
  it("shows the score and how many tasks are done", () => {
    render(<AppBarStats stats={{ score: 640, done: 5, total: 15 }} />);

    expect(screen.getByText("640")).toBeInTheDocument();
    expect(screen.getByText("5/15")).toBeInTheDocument();
    expect(screen.getByLabelText("Score 640, 5 of 15 tasks done")).toBeInTheDocument();
  });

  // B1 has no run to show, and a zero there would read as a score.
  it("renders nothing without a run", () => {
    const { container } = render(<AppBarStats stats={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
