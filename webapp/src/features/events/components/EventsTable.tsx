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

import {
  Button,
  Chip,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@wso2/oxygen-ui";
import type { JSX } from "react";
import { NULL_PLACEHOLDER } from "@constants/common";
import type { RallyEvent } from "@/types/event";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  formatRouteNames,
  formatStartTime,
} from "@features/events/utils/eventFormat";

const COL_SPAN = 6;
const SKELETON_ROWS = 3;

export interface EventsTableProps {
  events: RallyEvent[];
  isLoading: boolean;
  onOpen: (event: RallyEvent) => void;
}

const formatDate = (value: string): string => value || NULL_PLACEHOLDER;

/**
 * The A1 events table: Event, Date, Start, Route, Status and the row action.
 *
 * The action is Edit while an event can still change and View once it is
 * complete, because the backend refuses writes to a completed event.
 *
 * @param {EventsTableProps} props - Rows, loading state and the open handler.
 * @returns {JSX.Element} The events table.
 */
export default function EventsTable({
  events,
  isLoading,
  onOpen,
}: EventsTableProps): JSX.Element {
  return (
    <TableContainer component={Paper} sx={{ overflowX: "auto" }}>
      <Table sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            <TableCell>Event</TableCell>
            <TableCell>Date</TableCell>
            <TableCell>Start</TableCell>
            <TableCell>Route</TableCell>
            <TableCell>Status</TableCell>
            <TableCell align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {isLoading ? (
            Array.from({ length: SKELETON_ROWS }).map((_, row) => (
              <TableRow key={`skeleton-${row}`}>
                {Array.from({ length: COL_SPAN }).map((__, cell) => (
                  <TableCell key={cell}>
                    <Skeleton variant="text" width="80%" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : events.length === 0 ? (
            <TableRow>
              <TableCell align="center" colSpan={COL_SPAN}>
                <Typography color="text.secondary" variant="body2">
                  No events yet. Create one to start setting up the rally.
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            events.map((event) => {
              const isEditable = event.status !== "complete";

              return (
                <TableRow key={event.id} hover>
                  <TableCell>
                    <Typography fontWeight="medium" variant="body2">
                      {event.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography color="text.secondary" variant="body2">
                      {formatDate(event.eventDate)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {formatStartTime(event.startTime)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography color="text.secondary" variant="body2">
                      {formatRouteNames(event.routes)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      color={STATUS_COLORS[event.status]}
                      label={STATUS_LABELS[event.status]}
                      size="small"
                      sx={{ fontWeight: 500 }}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      onClick={() => onOpen(event)}
                      size="small"
                      type="button"
                      variant="outlined"
                    >
                      {isEditable ? "Edit" : "View"}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
