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

import { useEffect, useMemo, useState, type JSX } from "react";
import { useNavigate } from "react-router";
import {
  Box,
  Button,
  MenuItem,
  TablePagination,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { Plus } from "@wso2/oxygen-ui-icons-react";
import { useSearchEvents } from "@features/events/api/useSearchEvents";
import { useGetEventStats } from "@features/events/api/useGetEvent";
import EventsTable from "@features/events/components/EventsTable";
import StatGrid from "@features/events/components/StatGrid";
import AlertsCard from "@features/events/components/AlertsCard";
import { useErrorBanner } from "@context/error-banner/useErrorBanner";
import { getApiErrorMessage } from "@utils/ApiError";
import { DEFAULT_PAGE_SIZE } from "@constants/apiConstants";
import type { EventStatus, RallyEvent } from "@/types/event";

const ROWS_PER_PAGE_OPTIONS = [10, 20, 50];

const STATUS_FILTERS: { value: EventStatus | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "setup", label: "Setup" },
  { value: "active", label: "Active" },
  { value: "complete", label: "Complete" },
];

/**
 * A1 — the events dashboard.
 *
 * The stat cards describe one event, so they follow the running rally: the
 * first active event, falling back to the newest row on the page when nothing
 * is live yet.
 *
 * @returns {JSX.Element} The events dashboard.
 */
export default function EventsPage(): JSX.Element {
  const navigate = useNavigate();
  const { showError } = useErrorBanner();

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_PAGE_SIZE);
  const [status, setStatus] = useState<EventStatus | "">("");

  const {
    data,
    error,
    isLoading: isEventsLoading,
  } = useSearchEvents({
    offset: page * rowsPerPage,
    limit: rowsPerPage,
    status,
  });

  // Counted separately from the current page: the filter and pagination must
  // not change what "Active" means.
  const { data: activeEvents, error: activeEventsError } = useSearchEvents({
    limit: 1,
    status: "active",
  });

  const events = useMemo(() => data?.items ?? [], [data]);
  // The dashboard describes the live event, so it follows the unfiltered
  // active-event query rather than whatever the table is currently showing.
  // Reading it off the page would make filtering to "setup" quietly repoint
  // the statistics and alerts at a non-active event while the Active count
  // still described the live one.
  const focusedEvent =
    activeEvents?.items[0] ??
    events.find((event) => event.status === "active") ??
    events[0];
  const {
    data: stats,
    error: statsError,
    isLoading: isStatsLoading,
  } = useGetEventStats(focusedEvent?.id);

  useEffect(() => {
    if (error) {
      showError(getApiErrorMessage(error) ?? "Could not load events.");
    }
  }, [error, showError]);

  // A failed metric must not read as a real zero: "0 active events" and "0
  // alerts" are exactly what an organizer would act on.
  useEffect(() => {
    if (activeEventsError) {
      showError(
        getApiErrorMessage(activeEventsError) ??
          "Could not load the active event count.",
      );
    }
  }, [activeEventsError, showError]);

  useEffect(() => {
    if (statsError) {
      showError(
        getApiErrorMessage(statsError) ?? "Could not load event statistics.",
      );
    }
  }, [statsError, showError]);

  const openEvent = (event: RallyEvent): void => {
    void navigate(`/events/${event.id}/setup`);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
      <Box sx={{ alignItems: "center", display: "flex", gap: 1.5 }}>
        <Typography sx={{ flex: 1 }} variant="h5">
          Events
        </Typography>
        <TextField
          label="Status"
          onChange={(e) => {
            setStatus(e.target.value as EventStatus | "");
            setPage(0);
          }}
          select
          size="small"
          sx={{ width: 180 }}
          value={status}
        >
          {STATUS_FILTERS.map((option) => (
            <MenuItem key={option.value || "all"} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
        <Button
          onClick={() => void navigate("/events/new")}
          startIcon={<Plus size={16} />}
          type="button"
          variant="contained"
        >
          New event
        </Button>
      </Box>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        <StatGrid
          activeCount={activeEvents?.totalCount ?? 0}
          isLoading={isEventsLoading || isStatsLoading}
          stats={stats}
        />
        <AlertsCard
          isLoading={isEventsLoading || isStatsLoading}
          onView={() => void navigate("/monitor")}
          openAlerts={stats?.openAlerts ?? 0}
        />
      </Box>

      <EventsTable
        events={events}
        isLoading={isEventsLoading}
        onOpen={openEvent}
      />

      <TablePagination
        component="div"
        count={data?.totalCount ?? 0}
        onPageChange={(_, nextPage) => setPage(nextPage)}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={ROWS_PER_PAGE_OPTIONS}
      />
    </Box>
  );
}
