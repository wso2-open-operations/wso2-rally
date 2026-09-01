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
import FleetToolbar from "@features/vehicles/components/FleetToolbar";

const renderToolbar = (
  overrides: Partial<React.ComponentProps<typeof FleetToolbar>> = {},
) => {
  const props = {
    isExporting: false,
    isImporting: false,
    canExport: true,
    onImport: vi.fn(),
    onExport: vi.fn(),
    ...overrides,
  };
  render(<FleetToolbar {...props} />);

  return props;
};

describe("FleetToolbar", () => {
  // The wireframe shows 📥 / 📤 with no caption, so the only name these controls
  // have is the accessible one.
  it("gives the icon-only CSV controls accessible names and no visible text", () => {
    renderToolbar();

    const importButton = screen.getByRole("button", { name: "Import from CSV" });
    const exportButton = screen.getByRole("button", { name: "Export to CSV" });

    expect(importButton).toBeInTheDocument();
    expect(exportButton).toBeInTheDocument();
    expect(importButton).toHaveTextContent("");
    expect(exportButton).toHaveTextContent("");
  });

  it("opens the import dialog rather than importing straight away", async () => {
    const user = userEvent.setup();
    const props = renderToolbar();

    await user.click(screen.getByRole("button", { name: "Import from CSV" }));

    expect(props.onImport).toHaveBeenCalledTimes(1);
  });

  it("exports on demand", async () => {
    const user = userEvent.setup();
    const props = renderToolbar();

    await user.click(screen.getByRole("button", { name: "Export to CSV" }));

    expect(props.onExport).toHaveBeenCalledTimes(1);
  });

  // Exporting an empty fleet downloads a header-only file, which reads as a
  // broken download rather than an empty one.
  it("disables export when there is nothing to export", () => {
    renderToolbar({ canExport: false });

    expect(screen.getByRole("button", { name: "Export to CSV" })).toBeDisabled();
  });

  it("locks both controls while a transfer is in flight", () => {
    renderToolbar({ isImporting: true });

    expect(screen.getByRole("button", { name: "Import from CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export to CSV" })).toBeDisabled();
  });
});
