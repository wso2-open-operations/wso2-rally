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

import { vi } from "vitest";
import "@testing-library/jest-dom";
import type { RallyWindowConfig } from "@config/portalConfig";

// The real config.js is served by the browser at runtime and is gitignored, so
// tests supply their own. Modules that read config at import time (themeConfig,
// authConfig) need it present before the first import runs.
window.config = {
  RALLY_BACKEND_BASE_URL: "http://localhost:8080",
  RALLY_ASGARDEO_BASE_URL: "https://api.asgardeo.io/t/test",
  RALLY_ASGARDEO_CLIENT_ID: "test-client-id",
  RALLY_ASGARDEO_SIGN_IN_REDIRECT_URL: "http://localhost:3000",
  RALLY_ASGARDEO_SIGN_OUT_REDIRECT_URL: "http://localhost:3000",
} satisfies RallyWindowConfig;

// Asgardeo pulls in browser-only crypto and buffer plumbing that jsdom cannot
// satisfy. Component tests care about the token being attached, not about how
// it was minted.
vi.mock("@asgardeo/react", () => ({
  useAsgardeo: () => ({
    isSignedIn: true,
    isLoading: false,
    user: { email: "organizer@wso2.com" },
    signIn: vi.fn(),
    signOut: vi.fn(),
    getIdToken: vi.fn().mockResolvedValue("mock-id-token"),
    getAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
  }),
  AsgardeoProvider: ({ children }: { children: unknown }) => children,
}));

// Leaflet measures the DOM, which jsdom does not lay out. Map-bearing pages are
// tested for their form and controls; the map itself renders as a stub.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: unknown }) => children,
  TileLayer: () => null,
  Marker: () => null,
  Circle: () => null,
  useMapEvents: () => null,
  useMap: () => ({ setView: vi.fn(), flyTo: vi.fn() }),
}));
