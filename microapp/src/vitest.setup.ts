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

import "@testing-library/jest-dom";

// Leaflet measures the DOM, which jsdom does not lay out. Map-bearing screens
// are tested for their controls; the map itself renders as a stub.
//
// Draw pins with CircleMarker rather than Marker (see the plan's file:// note):
// Marker's default icon is a PNG resolved relative to the page, which is a coin
// toss from a file:// origin. Widen this stub as screens reach for more of the
// map API — a method a component calls but the stub lacks fails inside
// react-leaflet, which is a confusing place to debug from.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children?: unknown }) => children,
  TileLayer: () => null,
  Circle: () => null,
  CircleMarker: () => null,
  Polyline: () => null,
  Tooltip: () => null,
  useMapEvents: () => null,
  useMap: () => ({
    setView: vi.fn(),
    flyTo: vi.fn(),
    getZoom: vi.fn(() => 13),
    getCenter: vi.fn(() => ({ lat: 0, lng: 0 })),
    invalidateSize: vi.fn(),
  }),
}));
