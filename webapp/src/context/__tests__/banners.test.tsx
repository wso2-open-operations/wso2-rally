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
import userEvent from "@testing-library/user-event";
import { ErrorBannerProvider } from "@context/error-banner/ErrorBannerContext";
import { useErrorBanner } from "@context/error-banner/useErrorBanner";
import { SuccessBannerProvider } from "@context/success-banner/SuccessBannerContext";
import { useSuccessBanner } from "@context/success-banner/useSuccessBanner";

function ErrorTrigger(): React.ReactElement {
  const { showError } = useErrorBanner();

  return <button onClick={() => showError("Could not publish the event.")}>fail</button>;
}

function SuccessTrigger(): React.ReactElement {
  const { showSuccess } = useSuccessBanner();

  return <button onClick={() => showSuccess("Event published.")}>ok</button>;
}

describe("banner providers", () => {
  it("shows an error message and lets the user dismiss it", async () => {
    const user = userEvent.setup();
    render(
      <ErrorBannerProvider>
        <ErrorTrigger />
      </ErrorBannerProvider>,
    );

    await user.click(screen.getByRole("button", { name: "fail" }));
    expect(screen.getByText("Could not publish the event.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByText("Could not publish the event.")).not.toBeInTheDocument();
  });

  it("shows a success message", async () => {
    const user = userEvent.setup();
    render(
      <SuccessBannerProvider>
        <SuccessTrigger />
      </SuccessBannerProvider>,
    );

    await user.click(screen.getByRole("button", { name: "ok" }));

    expect(screen.getByText("Event published.")).toBeInTheDocument();
  });

  // Every consumer reaches the banner through its provider; a bare hook call is
  // a wiring mistake that should fail loudly rather than no-op.
  it("refuses to run outside its provider", () => {
    expect(() => render(<ErrorTrigger />)).toThrow(/ErrorBannerProvider/);
  });
});
