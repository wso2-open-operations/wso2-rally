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

import { useCallback, useState, type FormEvent, type JSX, type KeyboardEvent } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Search } from "@wso2/oxygen-ui-icons-react";
import MapPicker from "@components/map-picker/MapPicker";
import { reverseGeocode, searchPlace } from "@utils/geocoding";
import {
  EMPTY_BOUNDARY,
  isBoundaryPlaced,
  type Boundary,
  type CreateEventRequest,
  type RallyEvent,
} from "@/types/event";

/** The synchronised start every crew's phone counts down to. */
const DEFAULT_START_TIME = "09:00";

export interface EventFormProps {
  /** Undefined while creating; the stored event while editing. */
  event: RallyEvent | undefined;
  isSaving: boolean;
  isPublishing: boolean;
  onSave: (body: CreateEventRequest) => void;
  onPublish: () => void;
}

interface FormState {
  name: string;
  eventDate: string;
  startTime: string;
  cipher: string;
  start: Boundary;
  end: Boundary;
}

type FieldErrors = Partial<Record<"name" | "eventDate" | "startTime", string>>;

const toFormState = (event: RallyEvent | undefined): FormState => ({
  name: event?.name ?? "",
  eventDate: event?.eventDate ?? "",
  startTime: event?.startTime ?? DEFAULT_START_TIME,
  cipher: event?.cipher ?? "",
  start: event?.start ?? { ...EMPTY_BOUNDARY },
  end: event?.end ?? { ...EMPTY_BOUNDARY },
});

const validate = (form: FormState): FieldErrors => {
  const errors: FieldErrors = {};
  if (!form.name.trim()) {
    errors.name = "Name is required.";
  }
  if (!form.eventDate) {
    errors.eventDate = "Event date is required.";
  }
  if (!/^\d{2}:\d{2}$/.test(form.startTime)) {
    errors.startTime = "Start time must be HH:MM.";
  }

  return errors;
};

/**
 * The A2 event setup form: name, date, 09:00 auto-start, the cipher, and the
 * two boundary geofences placed on a map.
 *
 * Publish is offered only for a `setup` event with both boundaries placed —
 * the same rule the backend enforces — so the button never promises a 400.
 * A `complete` event renders read-only, because the backend refuses writes to it.
 *
 * @param {EventFormProps} props - The event under edit and its save handlers.
 * @returns {JSX.Element} The setup form.
 */
export default function EventForm({
  event,
  isSaving,
  isPublishing,
  onSave,
  onPublish,
}: EventFormProps): JSX.Element {
  // Seeded once per mounted event. EventSetupPage keys this component by event
  // id, so switching events remounts with fresh state, while a refetch of the
  // same event leaves an organizer's in-progress edits alone.
  const [form, setForm] = useState<FormState>(() => toFormState(event));
  const [errors, setErrors] = useState<FieldErrors>({});

  const isReadOnly = event?.status === "complete";
  const canPublish =
    event !== undefined &&
    event.status === "setup" &&
    isBoundaryPlaced(form.start) &&
    isBoundaryPlaced(form.end);

  const setField = useCallback(
    <K extends keyof FormState>(field: K, value: FormState[K]) => {
      setForm((previous) => ({ ...previous, [field]: value }));
    },
    [],
  );

  const setBoundary = useCallback(
    (which: "start" | "end", patch: Partial<Boundary>) => {
      setForm((previous) => ({
        ...previous,
        [which]: { ...previous[which], ...patch },
      }));
    },
    [],
  );

  // Which boundary is mid-lookup, and whether the last one found nothing. Keyed
  // by boundary so searching the start never blocks or mislabels the end.
  const [locating, setLocating] = useState<"start" | "end" | null>(null);
  const [notFound, setNotFound] = useState<"start" | "end" | null>(null);

  /**
   * Moves a boundary's pin to whatever the organizer typed.
   *
   * On Enter, never on keystroke: the geocoder's usage policy forbids
   * autocomplete, and a request per character would breach it in a word.
   */
  const findTypedPlace = useCallback(
    async (which: "start" | "end", query: string) => {
      if (query.trim() === "") {
        return;
      }

      setLocating(which);
      setNotFound(null);
      const found = await searchPlace(query);
      setLocating(null);

      if (!found) {
        setNotFound(which);

        return;
      }

      // The canonical short name replaces what was typed, so the field confirms
      // *which* "Bandaragama" the pin landed on.
      setBoundary(which, { lat: found.lat, lng: found.lng, label: found.label });
    },
    [setBoundary],
  );

  /**
   * Places a boundary where the organizer clicked and names it.
   *
   * The coordinates are the authoritative part and are set immediately; the name
   * follows when the geocoder answers, so a slow or unreachable provider still
   * leaves a usable pin. A point with no name keeps whatever label was there.
   */
  const placeAndName = useCallback(
    async (which: "start" | "end", position: { lat: number; lng: number }) => {
      setBoundary(which, position);
      setNotFound(null);

      setLocating(which);
      const name = await reverseGeocode(position.lat, position.lng);
      setLocating(null);

      if (name) {
        setBoundary(which, { label: name });
      }
    },
    [setBoundary],
  );

  /** The shared adornment + helper text for both location fields. */
  const locationFieldProps = (which: "start" | "end") => ({
    disabled: isReadOnly,
    helperText:
      notFound === which
        ? "No place found by that name — click the map to place the pin instead."
        : "Type a place and press Enter, or click the map.",
    error: notFound === which,
    onKeyDown: (keyEvent: KeyboardEvent<HTMLDivElement>) => {
      if (keyEvent.key === "Enter") {
        // The form's submit is a save; Enter here means "find this".
        keyEvent.preventDefault();
        void findTypedPlace(which, form[which].label);
      }
    },
    InputProps: {
      endAdornment: (
        <InputAdornment position="end">
          {locating === which ? (
            <CircularProgress size={16} />
          ) : (
            <Tooltip title="Find this place">
              <IconButton
                // Not "…start location…": that would collide with the field's
                // own label and make getByLabelText ambiguous.
                aria-label={`Find the ${which} point on the map`}
                disabled={isReadOnly || form[which].label.trim() === ""}
                edge="end"
                onClick={() => void findTypedPlace(which, form[which].label)}
                size="small"
              >
                <Search size={16} />
              </IconButton>
            </Tooltip>
          )}
        </InputAdornment>
      ),
    },
  });

  const handleSubmit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      return;
    }

    onSave({
      name: form.name.trim(),
      eventDate: form.eventDate,
      startTime: form.startTime,
      cipher: form.cipher.trim(),
      start: form.start,
      end: form.end,
    });
  };

  return (
    <Paper component="form" onSubmit={handleSubmit} sx={{ p: { xs: 2, md: 3 } }}>
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          gap: 3,
        }}
      >
        <Box sx={{ display: "flex", flex: 1, flexDirection: "column", gap: 2 }}>
          <TextField
            disabled={isReadOnly}
            error={Boolean(errors.name)}
            fullWidth
            helperText={errors.name}
            label="Event name"
            onChange={(e) => setField("name", e.target.value)}
            size="small"
            value={form.name}
          />
          <TextField
            disabled={isReadOnly}
            error={Boolean(errors.eventDate)}
            fullWidth
            helperText={errors.eventDate}
            InputLabelProps={{ shrink: true }}
            label="Date"
            onChange={(e) => setField("eventDate", e.target.value)}
            size="small"
            type="date"
            value={form.eventDate}
          />
          <TextField
            disabled={isReadOnly}
            error={Boolean(errors.startTime)}
            fullWidth
            helperText={
              errors.startTime ??
              "Every bound phone receives the start signal at this time."
            }
            InputLabelProps={{ shrink: true }}
            label="Auto-start time"
            onChange={(e) => setField("startTime", e.target.value)}
            size="small"
            type="time"
            value={form.startTime}
          />
          <TextField
            disabled={isReadOnly}
            fullWidth
            helperText="Revealed to every crew on the start signal."
            label="Cipher"
            onChange={(e) => setField("cipher", e.target.value)}
            size="small"
            value={form.cipher}
          />

          <Divider />

          <Box sx={{ display: "flex", gap: 1.5 }}>
            <TextField
              {...locationFieldProps("start")}
              label="Start location"
              onChange={(e) => setBoundary("start", { label: e.target.value })}
              size="small"
              sx={{ flex: 1 }}
              value={form.start.label}
            />
            <TextField
              disabled={isReadOnly}
              inputProps={{ min: 0 }}
              label="Start boundary radius (m)"
              onChange={(e) =>
                setBoundary("start", { radiusM: Number(e.target.value) })
              }
              size="small"
              sx={{ width: 190 }}
              type="number"
              value={form.start.radiusM}
            />
          </Box>
          <Box sx={{ display: "flex", gap: 1.5 }}>
            <TextField
              {...locationFieldProps("end")}
              label="End location"
              onChange={(e) => setBoundary("end", { label: e.target.value })}
              size="small"
              sx={{ flex: 1 }}
              value={form.end.label}
            />
            <TextField
              disabled={isReadOnly}
              inputProps={{ min: 0 }}
              label="End boundary radius (m)"
              onChange={(e) =>
                setBoundary("end", { radiusM: Number(e.target.value) })
              }
              size="small"
              sx={{ width: 190 }}
              type="number"
              value={form.end.radiusM}
            />
          </Box>
        </Box>

        <Box sx={{ display: "flex", flex: 1, flexDirection: "column", gap: 2 }}>
          <MapPicker
            label="Start grid geofence"
            lat={form.start.lat}
            lng={form.start.lng}
            onChange={(position) => void placeAndName("start", position)}
            radiusM={form.start.radiusM}
            readOnly={isReadOnly}
          />
          <MapPicker
            label="Arrival geofence"
            lat={form.end.lat}
            lng={form.end.lng}
            onChange={(position) => void placeAndName("end", position)}
            radiusM={form.end.radiusM}
            readOnly={isReadOnly}
          />
        </Box>
      </Box>

      {!isReadOnly && (
        <Box
          sx={{
            alignItems: "center",
            display: "flex",
            gap: 1.5,
            justifyContent: "flex-end",
            mt: 3,
          }}
        >
          {event?.status === "setup" && !canPublish && (
            <Typography color="text.secondary" variant="caption">
              Place both geofences on the map to publish.
            </Typography>
          )}
          <Button
            disabled={isSaving}
            startIcon={isSaving ? <CircularProgress color="inherit" size={16} /> : undefined}
            type="submit"
            variant="outlined"
          >
            Save
          </Button>
          {event?.status === "setup" && (
            <Button
              disabled={!canPublish || isPublishing || isSaving}
              onClick={onPublish}
              startIcon={
                isPublishing ? <CircularProgress color="inherit" size={16} /> : undefined
              }
              type="button"
              variant="contained"
            >
              Publish
            </Button>
          )}
        </Box>
      )}
    </Paper>
  );
}
