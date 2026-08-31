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

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StatGrid from "@features/events/components/StatGrid";
import AlertsCard from "@features/events/components/AlertsCard";

describe("StatGrid", () => {
  it("shows the A1 headline counts", () => {
    render(
      <StatGrid
        activeCount={1}
        stats={{ vehicles: 150, crews: 600, tasks: 15, openAlerts: 3 }}
        isLoading={false}
      />,
    );

    expect(screen.getByText("Active").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Vehicles").parentElement).toHaveTextContent("150");
    expect(screen.getByText("Crews").parentElement).toHaveTextContent("600");
    expect(screen.getByText("Tasks").parentElement).toHaveTextContent("15");
  });

  // Without an event there is nothing to count, so the cards must read zero
  // rather than blank — a blank card looks like a failed request.
  it("reads zero when no event is selected", () => {
    render(<StatGrid activeCount={0} stats={undefined} isLoading={false} />);

    expect(screen.getByText("Vehicles").parentElement).toHaveTextContent("0");
  });
});

describe("AlertsCard", () => {
  it("shows the open alert count and opens the monitor", async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    render(<AlertsCard openAlerts={3} isLoading={false} onView={onView} />);

    expect(screen.getByText("3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /alerts/i }));
    expect(onView).toHaveBeenCalled();
  });

  // A quiet rally should not offer a link into an empty alert list.
  it("is not actionable when nothing is open", () => {
    render(<AlertsCard openAlerts={0} isLoading={false} onView={vi.fn()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
