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

import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { useSearchEvents } from "@features/events/api/useSearchEvents";
import type { RallyEvent } from "@/types/event";

/** Query parameter carrying the selection, so a page is linkable and reloadable. */
export const EVENT_ID_PARAM = "eventId";

// An organizer runs a handful of events, not hundreds, so one page covers the
// picker. 100 is the server-side cap on a search window.
const EVENT_PAGE_SIZE = 100;

export interface EventSelection {
  events: RallyEvent[];
  /** The event the page should show, or undefined before events load. */
  selectedEvent: RallyEvent | undefined;
  selectedEventId: string | undefined;
  selectEvent: (eventId: string) => void;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Resolves which event the feature pages (Tasks, Routes, Vehicles) are working
 * against.
 *
 * The A3–A5 wireframes are top-level pages with no event in the path, so the
 * event has to come from somewhere: this reads `?eventId=`, and falls back to
 * the running rally — the first active event, then the newest — so an organizer
 * who clicks "Tasks" during the event lands on the right one without choosing.
 *
 * @returns {EventSelection} The event list, the resolved selection, and a setter.
 */
export function useEventSelection(): EventSelection {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, error, isLoading } = useSearchEvents({ limit: EVENT_PAGE_SIZE });

  const events = useMemo(() => data?.items ?? [], [data]);
  const requestedId = searchParams.get(EVENT_ID_PARAM) ?? undefined;

  const selectedEvent = useMemo(() => {
    // A stale or hand-edited id falls back rather than showing an empty page.
    const requested = events.find((event) => event.id === requestedId);

    return requested ?? events.find((event) => event.status === "active") ?? events[0];
  }, [events, requestedId]);

  const selectEvent = useCallback(
    (eventId: string) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set(EVENT_ID_PARAM, eventId);

          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return {
    events,
    selectedEvent,
    selectedEventId: selectedEvent?.id,
    selectEvent,
    isLoading,
    error: error ?? null,
  };
}
