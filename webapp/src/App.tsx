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

import { type JSX } from "react";
import { Navigate, Route, Routes } from "react-router";
import AuthGuard from "@layouts/AuthGuard";
import ErrorLayout from "@layouts/ErrorLayout";
import Error404Page from "@components/error/Error404Page";
import ComingSoonPage from "@components/placeholder/ComingSoonPage";
import EventsPage from "@features/events/pages/EventsPage";
import EventSetupPage from "@features/events/pages/EventSetupPage";
import RoutesPage from "@features/routes/pages/RoutesPage";
import MonitorPage from "@features/monitor/pages/MonitorPage";
import TasksPage from "@features/tasks/pages/TasksPage";
import VehiclesPage from "@features/vehicles/pages/VehiclesPage";
import { LoaderProvider } from "@context/linear-loader/LoaderContext";
import { ErrorBannerProvider } from "@context/error-banner/ErrorBannerContext";
import { SuccessBannerProvider } from "@context/success-banner/SuccessBannerContext";

export default function App(): JSX.Element {
  return (
    <LoaderProvider>
      <ErrorBannerProvider>
        <SuccessBannerProvider>
          <Routes>
            <Route element={<AuthGuard />}>
              {/* Events is the organizer's landing surface: nothing else can be
                  set up until an event exists. */}
              <Route index element={<Navigate to="/events" replace />} />

              <Route path="events">
                <Route index element={<EventsPage />} />
                <Route path="new" element={<EventSetupPage />} />
                <Route path=":eventId/setup" element={<EventSetupPage />} />
              </Route>

              <Route path="routes" element={<RoutesPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="vehicles" element={<VehiclesPage />} />
              <Route path="monitor" element={<MonitorPage />} />

              {/* Wireframes A7–A8 — routed so the sidebar never dead-ends. */}
              <Route
                path="leaderboard"
                element={<ComingSoonPage title="Leaderboard" screen="A7" />}
              />
              <Route
                path="debrief"
                element={<ComingSoonPage title="Debrief" screen="A8" />}
              />
            </Route>

            <Route
              path="*"
              element={
                <ErrorLayout>
                  <Error404Page />
                </ErrorLayout>
              }
            />
          </Routes>
        </SuccessBannerProvider>
      </ErrorBannerProvider>
    </LoaderProvider>
  );
}
