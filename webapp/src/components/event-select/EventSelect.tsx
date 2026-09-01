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

import { MenuItem, Skeleton, TextField } from "@wso2/oxygen-ui";
import type { JSX } from "react";
import type { RallyEvent } from "@/types/event";
import { STATUS_LABELS } from "@features/events/utils/eventFormat";

export interface EventSelectProps {
  events: RallyEvent[];
  selectedEventId: string | undefined;
  onChange: (eventId: string) => void;
  isLoading: boolean;
}

/**
 * Picks which event a feature page is working against.
 *
 * Shared by Tasks, and by Routes and Vehicles when they are built — the A3–A5
 * screens are all top-level pages that need an event before they can show
 * anything.
 *
 * @param {EventSelectProps} props - The event list and the current selection.
 * @returns {JSX.Element} The event picker.
 */
export default function EventSelect({
  events,
  selectedEventId,
  onChange,
  isLoading,
}: EventSelectProps): JSX.Element {
  if (isLoading) {
    return <Skeleton variant="rounded" height={40} width={260} />;
  }

  return (
    <TextField
      disabled={events.length === 0}
      helperText={events.length === 0 ? "Create an event first." : undefined}
      label="Event"
      onChange={(e) => onChange(e.target.value)}
      select
      size="small"
      sx={{ minWidth: 260 }}
      value={selectedEventId ?? ""}
    >
      {events.map((event) => (
        <MenuItem key={event.id} value={event.id}>
          {event.name} · {STATUS_LABELS[event.status]}
        </MenuItem>
      ))}
    </TextField>
  );
}
