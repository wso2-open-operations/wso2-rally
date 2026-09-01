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

import { useCallback, useEffect, useMemo, useReducer, useState, type JSX } from "react";
import { Box, Chip, Skeleton, Typography } from "@wso2/oxygen-ui";
import EventSelect from "@components/event-select/EventSelect";
import AlertsStrip from "@features/monitor/components/AlertsStrip";
import CompletionMatrix from "@features/monitor/components/CompletionMatrix";
import LiveMap from "@features/monitor/components/LiveMap";
import { useGetMonitorSnapshot } from "@features/monitor/api/useGetMonitorSnapshot";
import {
  emptyMonitorState,
  fromSnapshot,
  monitorReducer,
  parseMonitorMessage,
  type MonitorState,
} from "@features/monitor/monitorState";
import { useEventSelection } from "@hooks/useEventSelection";
import { useEventSocket } from "@hooks/useEventSocket";
import { useErrorBanner } from "@context/error-banner/useErrorBanner";
import { getApiErrorMessage } from "@utils/ApiError";
import type { MonitorMessage } from "@/types/monitor";

/** The reducer action set: a live frame, or a fresh snapshot to reset from. */
type MonitorAction =
  | { kind: "message"; message: MonitorMessage }
  | { kind: "reset"; state: MonitorState };

function reduce(state: MonitorState, action: MonitorAction): MonitorState {
  return action.kind === "reset"
    ? action.state
    : monitorReducer(state, action.message);
}

/**
 * A6 — the live monitor.
 *
 * Two channels, deliberately: `GET /events/{id}/monitor` gives the state as it
 * is now, and the `event:{id}` socket carries what changes after. The socket
 * sends no history, so a reconnect refetches the snapshot rather than resuming
 * — anything broadcast while it was down is gone.
 *
 * @returns {JSX.Element} The live monitor page.
 */
export default function MonitorPage(): JSX.Element {
  const { showError } = useErrorBanner();
  const {
    events,
    selectedEvent,
    selectedEventId,
    selectEvent,
    isLoading: isEventsLoading,
    error: eventsError,
  } = useEventSelection();

  const { data: snapshot, error, isLoading, refetch } = useGetMonitorSnapshot(selectedEventId);
  const [state, dispatch] = useReducer(reduce, undefined, emptyMonitorState);
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);

  const loadError = eventsError ?? error;

  useEffect(() => {
    if (loadError) {
      showError(getApiErrorMessage(loadError) ?? "Could not load the live monitor.");
    }
  }, [loadError, showError]);

  // Every snapshot — first load, event switch, post-reconnect refetch — replaces
  // the live state wholesale. It is the authority; the socket only moves it on.
  useEffect(() => {
    dispatch({ kind: "reset", state: snapshot ? fromSnapshot(snapshot) : emptyMonitorState() });
  }, [snapshot]);

  const handleMessage = useCallback((raw: string) => {
    const message = parseMonitorMessage(raw);
    if (!message) {
      return;
    }

    dispatch({ kind: "message", message });
    setLastFrameAt(Date.now());
  }, []);

  const handleReconnect = useCallback(() => {
    void refetch();
  }, [refetch]);

  const { connected, reconnecting } = useEventSocket(selectedEventId, {
    onMessage: handleMessage,
    onReconnect: handleReconnect,
  });

  const vehicles = useMemo(() => Object.values(state.vehicles), [state.vehicles]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
      <Box sx={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        <Typography variant="h5">Live monitor</Typography>
        <Chip
          color={connected ? "success" : reconnecting ? "warning" : "default"}
          label={
            connected
              ? "● WebSocket live"
              : reconnecting
                ? "● Reconnecting — showing the last known state"
                : "● Offline"
          }
          size="small"
          // The connection state is the one thing on this page an organizer must
          // not misread: stale markers look identical to live ones.
          role="status"
        />
        <Box sx={{ flex: 1 }} />
        <EventSelect
          events={events}
          isLoading={isEventsLoading}
          onChange={selectEvent}
          selectedEventId={selectedEventId}
        />
      </Box>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "flex-start" }}>
        {isLoading ? (
          <Skeleton height={480} sx={{ flex: 1, minWidth: 280 }} variant="rounded" />
        ) : (
          <LiveMap
            end={selectedEvent?.end}
            start={selectedEvent?.start}
            vehicles={vehicles}
          />
        )}

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            flex: "1 1 240px",
            maxWidth: { md: 320 },
            minWidth: 240,
          }}
        >
          <AlertsStrip alerts={state.alerts} openAlerts={state.openAlerts} />
          <CompletionMatrix vehicles={vehicles} />
        </Box>
      </Box>

      <Typography color="text.secondary" variant="caption">
        Positions and completions arrive over the event socket as crews report
        them. {lastFrameAt === null
          ? "Nothing has come through yet — quiet is normal before the 09:00 start."
          : `Last update ${new Date(lastFrameAt).toLocaleTimeString()}.`}
      </Typography>
    </Box>
  );
}
