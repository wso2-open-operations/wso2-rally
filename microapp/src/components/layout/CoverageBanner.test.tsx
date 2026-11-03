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

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppProvider from "@context/AppProvider";
import { LocationReporterContext } from "@context/LocationReporterContext";
import { SessionSocketContext } from "@context/SessionSocketContext";
import type { LocationReporter } from "@hooks/useLocationReporter";
import { initialSessionSocket } from "@hooks/useSessionSocket";
import type { SessionState } from "@/types/session.model";
import CoverageBanner from "./CoverageBanner";

const getState = vi.fn<() => Promise<SessionState>>();
vi.mock("@services/session", () => ({
  session: { state: () => ({ queryKey: ["session", "state"], queryFn: () => getState() }) },
}));
vi.mock("@config/endpoints", () => ({ WS_URL: "ws://backend.test/ws" }));

const start = vi.fn();
const reporter = (sharing: boolean): LocationReporter => ({
  sharing,
  position: null,
  failure: null,
  pingError: null,
  start,
});

const renderBanner = ({ frame = null as boolean | null, seeded = false, sharing = false } = {}) => {
  getState.mockResolvedValue({ coverageLost: seeded } as SessionState);
  return render(
    <AppProvider>
      <SessionSocketContext value={{ ...initialSessionSocket, connected: true, coverageLost: frame }}>
        <LocationReporterContext value={reporter(sharing)}>
          <CoverageBanner />
        </LocationReporterContext>
      </SessionSocketContext>
    </AppProvider>,
  );
};

const BANNER = /no phone in this car is reporting/i;

beforeEach(() => {
  getState.mockReset();
  start.mockReset();
});

describe("CoverageBanner", () => {
  it("appears when the server says the car has gone dark", async () => {
    renderBanner({ frame: true, seeded: false });

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    // An action a passenger can take, not "turn on GPS".
    expect(screen.getByText(/keep the rally app open with location on/i)).toBeInTheDocument();
  });

  it("clears when coverage is restored, whatever the last fetch said", async () => {
    renderBanner({ frame: false, seeded: true });
    await waitFor(() => expect(getState).toHaveBeenCalled());
    await act(async () => {}); // let the fetched state land

    expect(screen.queryByText(BANNER)).toBeNull();
  });

  // A phone that opens mid-outage missed the frame.
  it("is seeded from the session state when no frame has come", async () => {
    renderBanner({ frame: null, seeded: true });

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
  });

  it("starts sharing from the phone showing it", async () => {
    renderBanner({ frame: true });

    fireEvent.click(await screen.findByRole("button", { name: /share from this phone/i }));

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("offers no share button on a phone that is already sharing", async () => {
    renderBanner({ frame: true, sharing: true });

    expect(await screen.findByText(BANNER)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /share from this phone/i })).toBeNull();
  });
});
