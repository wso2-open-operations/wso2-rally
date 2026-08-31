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

import { useEffect, type JSX } from "react";
import { useNavigate, useParams } from "react-router";
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Typography,
} from "@wso2/oxygen-ui";
import { ArrowLeft } from "@wso2/oxygen-ui-icons-react";
import EventForm from "@features/events/components/EventForm";
import { useGetEvent } from "@features/events/api/useGetEvent";
import {
  useCreateEvent,
  usePublishEvent,
  useUpdateEvent,
} from "@features/events/api/useEventMutations";
import { STATUS_COLORS, STATUS_LABELS } from "@features/events/utils/eventFormat";
import { useErrorBanner } from "@context/error-banner/useErrorBanner";
import { useSuccessBanner } from "@context/success-banner/useSuccessBanner";
import { getApiErrorMessage, isNotFoundError } from "@utils/ApiError";
import Error404Page from "@components/error/Error404Page";
import type { CreateEventRequest } from "@/types/event";

/**
 * A2 — event setup.
 *
 * Serves both `/events/new` and `/events/:eventId/setup`: creating and editing
 * are the same form, and the first save on a new event swaps the route to the
 * edit URL so a refresh or a shared link lands back on the saved event.
 *
 * @returns {JSX.Element} The event setup page.
 */
export default function EventSetupPage(): JSX.Element {
  const { eventId } = useParams<{ eventId?: string }>();
  const navigate = useNavigate();
  const { showError } = useErrorBanner();
  const { showSuccess } = useSuccessBanner();

  const { data: event, error, isLoading, refetch } = useGetEvent(eventId);
  // An existing event that failed to load for any reason but "gone".
  const loadFailed = Boolean(eventId && error && !isNotFoundError(error));
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const publishEvent = usePublishEvent();

  useEffect(() => {
    if (error && !isNotFoundError(error)) {
      showError(getApiErrorMessage(error) ?? "Could not load the event.");
    }
  }, [error, showError]);

  const handleSave = (body: CreateEventRequest): void => {
    if (!eventId) {
      createEvent.mutate(body, {
        onSuccess: (created) => {
          showSuccess("Event created.");
          void navigate(`/events/${created.id}/setup`, { replace: true });
        },
        onError: (createError) =>
          showError(getApiErrorMessage(createError) ?? "Could not create the event."),
      });

      return;
    }

    updateEvent.mutate(
      { eventId, body },
      {
        onSuccess: () => showSuccess("Event saved."),
        onError: (updateError) =>
          showError(getApiErrorMessage(updateError) ?? "Could not save the event."),
      },
    );
  };

  const handlePublish = (): void => {
    if (!eventId) return;

    publishEvent.mutate(eventId, {
      onSuccess: () => showSuccess("Event published. Crews can now bind to it."),
      onError: (publishError) =>
        showError(getApiErrorMessage(publishError) ?? "Could not publish the event."),
    });
  };

  if (isNotFoundError(error)) {
    return <Error404Page />;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
      <Box sx={{ alignItems: "center", display: "flex", gap: 1.5 }}>
        <IconButton
          aria-label="Back to events"
          onClick={() => void navigate("/events")}
          size="small"
        >
          <ArrowLeft size={20} />
        </IconButton>
        <Typography sx={{ flex: 1 }} variant="h5">
          {eventId ? `Event setup · ${event?.name ?? ""}` : "New event"}
        </Typography>
        {event && (
          <Chip
            color={STATUS_COLORS[event.status]}
            label={STATUS_LABELS[event.status]}
            size="small"
            sx={{ fontWeight: 500 }}
            variant="outlined"
          />
        )}
      </Box>

      {isLoading ? (
        <LinearProgress color="warning" />
      ) : loadFailed ? (
        // Never an editable form over an event we could not read. The fields
        // would start empty, and saving would PATCH those blanks over the
        // stored boundaries and cipher.
        <Alert
          action={
            <Button color="inherit" onClick={() => void refetch()} size="small">
              Retry
            </Button>
          }
          severity="error"
          >
          Could not load this event. Nothing has been changed.
        </Alert>
      ) : (
        <EventForm
          key={event?.id ?? "new"}
          event={event}
          isPublishing={publishEvent.isPending}
          isSaving={createEvent.isPending || updateEvent.isPending}
          onPublish={handlePublish}
          onSave={handleSave}
        />
      )}
    </Box>
  );
}
