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

import "leaflet/dist/leaflet.css";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import NavigationIcon from "@mui/icons-material/Navigation";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useReducer, useState, type JSX } from "react";
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { Navigate, useNavigate } from "react-router-dom";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "@config/constants";
import { useReporter } from "@context/LocationReporterContext";
import { describePositionFailure } from "@sensors/position";
import { session } from "@services/session";
import { isEmbedded, openUrl } from "@utils/bridge";
import { formatDistance, haversineMeters, type LatLng } from "@utils/geo";
import { initialTileHealth, tileHealthReducer } from "@utils/tileHealth";
import type { Circle as Fence } from "@/types/session.model";

const AFTER_FINISH = "/arrival";
const MAP_ZOOM = 14;

/** Google Maps' cross-platform directions link: the app when installed, the web otherwise. */
const directionsUrl = ({ lat, lng }: LatLng): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

/** Keeps the car in view as it moves, at whatever zoom the crew chose. */
function FollowCar({ position }: { position: LatLng | null }): null {
  const map = useMap();
  const lat = position?.lat;
  const lng = position?.lng;
  useEffect(() => {
    if (lat !== undefined && lng !== undefined) {
      map.setView([lat, lng], map.getZoom());
    }
  }, [map, lat, lng]);

  return null;
}

/**
 * B4 — the idle screen between checkpoints: where the next one is, how far,
 * and what waits there.
 *
 * This is where reporting starts: the car leaves the grid from here. The
 * reporter itself lives in `SessionLayout`, so it keeps going into a task and
 * back, and whatever a ping unlocks moves the crew from there.
 *
 * The map is the least important thing on the screen. When its imagery stops
 * loading on a rural stretch, the pins, the fences and the course stay drawn
 * over a plain backdrop, a quiet caption says so, and the distance — which
 * needs no tiles — carries the navigation. Nothing about the pings changes:
 * geofencing is server-side arithmetic on coordinates and never used a tile.
 */
export default function RoutePage(): JSX.Element {
  const navigate = useNavigate();
  const theme = useTheme();
  const reporter = useReporter();
  const run = useQuery(session.state());
  const list = useQuery(session.tasks());
  const [tiles, tileEvent] = useReducer(tileHealthReducer, initialTileHealth);
  const [confirming, setConfirming] = useState(false);
  const [navigateError, setNavigateError] = useState<string | null>(null);

  const { start } = reporter;
  useEffect(() => {
    start();
  }, [start]);

  if (run.data?.session.status === "finished") {
    return <Navigate replace to={AFTER_FINISH} />;
  }

  if (run.isPending) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress aria-label="Loading your run" />
      </Box>
    );
  }

  if (run.isError) {
    return (
      <Box component="main" sx={{ p: 3, maxWidth: 480, mx: "auto" }}>
        <Alert
          action={
            <Button color="inherit" onClick={() => void run.refetch()} size="small">
              Try again
            </Button>
          }
          severity="error"
        >
          {run.error.message}
        </Alert>
      </Box>
    );
  }

  const state = run.data;
  const next = state.waypoints.find((waypoint) => waypoint.id === state.nextWaypointId) ?? null;
  const target: Fence = next ? next.circle : state.finishCircle;
  const { position, failure, pingError } = reporter;
  const toGo = position && target.placed ? Math.max(0, haversineMeters(position, target) - target.radiusM) : null;

  const tasks = list.data ?? [];
  const here = state.session.currentWaypointId;
  const openHere = here ? tasks.filter((task) => task.waypointId === here && task.status === "pending") : [];
  const waitingNext = next ? tasks.filter((task) => task.waypointId === next.id && task.status === "pending") : [];

  // Google Maps backgrounds the rally app. If no other phone is reporting, the
  // car goes dark until the driver comes back.
  const othersSharing = state.sharingCount - (state.you.sharing ? 1 : 0);
  const onlyThisPhone = reporter.sharing && othersSharing <= 0;

  const openMaps = async (): Promise<void> => {
    setConfirming(false);
    setNavigateError(null);
    const url = directionsUrl(target);
    try {
      if (isEmbedded()) {
        await openUrl({ url });
      } else {
        window.open(url, "_blank", "noopener");
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setNavigateError(`Could not open Google Maps (${reason}). Head for the checkpoint using the distance above.`);
    }
  };

  const course = [state.startCircle, ...state.waypoints.map((waypoint) => waypoint.circle), state.finishCircle]
    .filter((fence) => fence.placed)
    .map((fence): [number, number] => [fence.lat, fence.lng]);
  const centre: LatLng = position ?? (target.placed ? target : state.startCircle);

  return (
    <Box component="main" sx={{ display: "flex", flexDirection: "column", gap: 2, p: 2, maxWidth: 480, mx: "auto" }}>
      <Paper sx={{ p: 2 }} variant="outlined">
        <Typography color="text.secondary" variant="overline">
          Next
        </Typography>
        <Typography component="h1" variant="h6">
          {next ? `Checkpoint ${next.order}` : "Finish"}
        </Typography>
        {target.placed ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
            <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }} variant="h3">
              {toGo === null ? "—" : formatDistance(toGo)}
            </Typography>
            <Typography color="text.secondary">{toGo === null ? "Finding your position…" : "to go"}</Typography>
          </Stack>
        ) : (
          <Typography color="text.secondary">Not placed on the map yet — ask an organizer.</Typography>
        )}
        {waitingNext.length > 0 && (
          <Typography color="text.secondary" variant="body2">
            {waitingNext.map((task) => task.title).join(" · ")}
          </Typography>
        )}
      </Paper>

      {openHere.length > 0 && (
        <Paper variant="outlined">
          <Typography color="text.secondary" sx={{ px: 2, pt: 1 }} variant="overline">
            Open at this checkpoint
          </Typography>
          <List dense disablePadding>
            {openHere.map((task) => (
              <ListItemButton key={task.id} onClick={() => navigate(`/task/${encodeURIComponent(task.id)}`)}>
                <ListItemText primary={task.title} secondary={`${task.code} · ${task.points} pts`} />
                <ChevronRightIcon aria-hidden />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}

      {failure && (
        <Alert
          action={
            <Button color="inherit" onClick={reporter.start} size="small">
              Try again
            </Button>
          }
          severity="warning"
        >
          {describePositionFailure(failure)}
        </Alert>
      )}
      {pingError && !failure && (
        <Typography color="warning.main" variant="caption">
          {`The car's position did not reach the rally server: ${pingError}`}
        </Typography>
      )}

      <Box sx={{ height: 240, borderRadius: 1, overflow: "hidden", bgcolor: "action.hover" }}>
        <MapContainer
          center={[centre.lat, centre.lng]}
          style={{ height: "100%", width: "100%", background: "transparent" }}
          zoom={MAP_ZOOM}
        >
          <TileLayer
            attribution={MAP_ATTRIBUTION}
            eventHandlers={{ tileerror: () => tileEvent("errored"), tileload: () => tileEvent("loaded") }}
            url={MAP_TILE_URL}
          />
          {course.length > 1 && <Polyline pathOptions={{ color: theme.palette.text.secondary }} positions={course} />}
          {state.waypoints
            .filter((waypoint) => waypoint.circle.placed)
            .map((waypoint) => (
              <Circle
                center={[waypoint.circle.lat, waypoint.circle.lng]}
                key={waypoint.id}
                pathOptions={{ color: theme.palette.text.secondary, weight: 1 }}
                radius={waypoint.circle.radiusM}
              />
            ))}
          {target.placed && (
            <CircleMarker
              center={[target.lat, target.lng]}
              pathOptions={{ color: theme.palette.warning.main, fillOpacity: 0.9 }}
              radius={8}
            />
          )}
          {position && (
            <CircleMarker
              center={[position.lat, position.lng]}
              pathOptions={{ color: theme.palette.primary.main, fillOpacity: 0.9 }}
              radius={8}
            />
          )}
          <FollowCar position={position} />
        </MapContainer>
      </Box>
      {!tiles.available && (
        <Typography color="text.secondary" variant="caption">
          Map imagery unavailable. Your position and the distance to the next task are still live.
        </Typography>
      )}

      <Button
        disabled={!target.placed}
        onClick={() => (onlyThisPhone ? setConfirming(true) : void openMaps())}
        size="large"
        startIcon={<NavigationIcon />}
        variant="contained"
      >
        Navigate
      </Button>
      {navigateError && <Alert severity="error">{navigateError}</Alert>}

      <Button
        color="warning"
        onClick={() => navigate("/report")}
        size="large"
        startIcon={<WarningAmberIcon />}
        variant="outlined"
      >
        Report vehicle issue
      </Button>

      <Dialog onClose={() => setConfirming(false)} open={confirming}>
        <DialogTitle>Only phone sharing the car's position</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Google Maps pauses the rally app, and with it the car's position — a checkpoint passed meanwhile may not
            unlock. Ask a passenger to open the rally app with location on first.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button onClick={() => void openMaps()}>Navigate anyway</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
