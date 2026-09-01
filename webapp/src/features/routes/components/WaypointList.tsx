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

import { useState, type JSX } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Trash2,
  X,
} from "@wso2/oxygen-ui-icons-react";
import { movedDown, movedUp, type Waypoint } from "@/types/route";
import type { RallyTask } from "@/types/task";

export interface WaypointListProps {
  waypoints: Waypoint[];
  /** The event's task library, for the chips and the add-task picker. */
  tasks: RallyTask[];
  /** The waypoint whose settings panel is open, if any. */
  expandedId: string | null;
  /** True while a mutation is in flight; the reorder buttons lock. */
  isBusy: boolean;
  onExpand: (waypointId: string | null) => void;
  onReorder: (orderedIds: string[]) => void;
  onRadiusChange: (waypointId: string, radiusM: number) => void;
  onAttachTasks: (waypointId: string, taskIds: string[]) => void;
  onEdit: (waypoint: Waypoint) => void;
  onDelete: (waypoint: Waypoint) => void;
}

/**
 * The radius field, held locally so an organizer can type "120" without a PATCH
 * firing at "1" and again at "12". The parent is told once, on commit.
 *
 * Keyed on the server's value by its caller, so a refetch that brings a
 * different radius remounts this with the new one rather than stranding a
 * stale draft.
 */
function RadiusField({
  waypoint,
  disabled,
  onCommit,
}: {
  waypoint: Waypoint;
  disabled: boolean;
  onCommit: (radiusM: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(waypoint.boundaryRadiusM));

  const commit = (): void => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(waypoint.boundaryRadiusM));

      return;
    }
    if (parsed !== waypoint.boundaryRadiusM) {
      onCommit(Math.round(parsed));
    }
  };

  return (
    <TextField
      disabled={disabled}
      fullWidth
      helperText="Trigger zone for the tasks below"
      label="Coordinate boundary radius (m)"
      onBlur={commit}
      onChange={(changeEvent) => setDraft(changeEvent.target.value)}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Enter") {
          commit();
        }
      }}
      size="small"
      type="number"
      value={draft}
    />
  );
}

/**
 * A3's waypoint column: the driving order, each leg's geofence radius, and the
 * tasks that unlock inside it.
 *
 * Reordering sends the whole permutation rather than the moved pair — the
 * backend rejects a partial list, because a partial one would silently drop
 * legs from the course.
 *
 * @param {WaypointListProps} props - Rows, the task library, and the handlers.
 * @returns {JSX.Element} The waypoint list.
 */
export default function WaypointList({
  waypoints,
  tasks,
  expandedId,
  isBusy,
  onExpand,
  onReorder,
  onRadiusChange,
  onAttachTasks,
  onEdit,
  onDelete,
}: WaypointListProps): JSX.Element {
  const orderedIds = waypoints.map((waypoint) => waypoint.id);
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  if (waypoints.length === 0) {
    return (
      <Paper sx={{ p: 2 }} variant="outlined">
        <Typography color="text.secondary" variant="body2">
          No waypoints yet. Add the legs this route drives through — each one is
          a geofence that unlocks the tasks attached to it.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ display: "flex", flexDirection: "column" }} variant="outlined">
      {waypoints.map((waypoint, index) => {
        const isExpanded = expandedId === waypoint.id;
        const attached = waypoint.taskIds
          .map((taskId) => taskById.get(taskId))
          .filter((task): task is RallyTask => task !== undefined);
        const attachable = tasks.filter((task) => !waypoint.taskIds.includes(task.id));

        return (
          <Box key={waypoint.id}>
            {index > 0 && <Divider />}
            <Box
              sx={{
                alignItems: "center",
                display: "flex",
                gap: 0.5,
                p: 1,
                bgcolor: isExpanded ? "action.selected" : "transparent",
              }}
            >
              <Box sx={{ display: "flex", flexDirection: "column" }}>
                <IconButton
                  aria-label={`Move ${waypoint.label} up`}
                  disabled={isBusy || index === 0}
                  onClick={() => onReorder(movedUp(orderedIds, index))}
                  size="small"
                >
                  <ChevronUp size={14} />
                </IconButton>
                <IconButton
                  aria-label={`Move ${waypoint.label} down`}
                  disabled={isBusy || index === waypoints.length - 1}
                  onClick={() => onReorder(movedDown(orderedIds, index))}
                  size="small"
                >
                  <ChevronDown size={14} />
                </IconButton>
              </Box>

              <Box
                component="button"
                onClick={() => onExpand(isExpanded ? null : waypoint.id)}
                sx={{
                  alignItems: "center",
                  background: "none",
                  border: 0,
                  cursor: "pointer",
                  display: "flex",
                  flex: 1,
                  gap: 1,
                  minWidth: 0,
                  p: 0,
                  textAlign: "left",
                }}
                type="button"
              >
                <Typography
                  color="text.secondary"
                  sx={{ fontFamily: "monospace" }}
                  variant="caption"
                >
                  {index + 1}
                </Typography>
                <Typography
                  noWrap
                  sx={{ flex: 1, minWidth: 0 }}
                  variant="body2"
                >
                  {waypoint.label}
                </Typography>
                <Typography color="text.secondary" variant="caption">
                  {waypoint.boundaryRadiusM} m
                </Typography>
                {waypoint.taskIds.length > 0 && (
                  <Chip
                    color="primary"
                    label={waypoint.taskIds.length}
                    size="small"
                    variant="outlined"
                  />
                )}
                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </Box>
            </Box>

            {isExpanded && (
              <Box
                aria-label={`${waypoint.label} settings`}
                role="group"
                sx={{ display: "flex", flexDirection: "column", gap: 1.5, px: 1.5, pb: 1.5 }}
              >
                <RadiusField
                  disabled={isBusy}
                  key={`${waypoint.id}-${waypoint.boundaryRadiusM}`}
                  onCommit={(radiusM) => onRadiusChange(waypoint.id, radiusM)}
                  waypoint={waypoint}
                />

                <Box>
                  <Typography color="text.secondary" variant="caption">
                    Tasks at this waypoint
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                    {attached.length === 0 ? (
                      <Typography color="text.secondary" variant="caption">
                        None — this leg is a checkpoint only.
                      </Typography>
                    ) : (
                      attached.map((task) => (
                        <Tooltip key={task.id} title={task.title}>
                          <Chip
                            color="primary"
                            // MUI clones deleteIcon and hangs the click on it,
                            // so the accessible name has to live on the icon
                            // rather than on a wrapper.
                            deleteIcon={
                              <X aria-label={`Detach ${task.code}`} role="button" size={14} />
                            }
                            disabled={isBusy}
                            label={task.code}
                            onDelete={() =>
                              onAttachTasks(
                                waypoint.id,
                                waypoint.taskIds.filter((taskId) => taskId !== task.id),
                              )
                            }
                            size="small"
                          />
                        </Tooltip>
                      ))
                    )}
                  </Box>
                </Box>

                <TextField
                  disabled={isBusy || attachable.length === 0}
                  helperText={
                    attachable.length === 0
                      ? "Every task in the library is already attached somewhere on this waypoint."
                      : undefined
                  }
                  label="Add task"
                  onChange={(changeEvent) =>
                    onAttachTasks(waypoint.id, [
                      ...waypoint.taskIds,
                      changeEvent.target.value,
                    ])
                  }
                  select
                  size="small"
                  value=""
                >
                  {attachable.map((task) => (
                    <MenuItem key={task.id} value={task.id}>
                      {task.code} · {task.title}
                    </MenuItem>
                  ))}
                </TextField>

                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button
                    disabled={isBusy}
                    onClick={() => onEdit(waypoint)}
                    size="small"
                    startIcon={<Pencil size={14} />}
                    type="button"
                    variant="outlined"
                  >
                    Rename / move
                  </Button>
                  <Button
                    color="error"
                    disabled={isBusy}
                    onClick={() => onDelete(waypoint)}
                    size="small"
                    startIcon={<Trash2 size={14} />}
                    type="button"
                    variant="outlined"
                  >
                    Remove
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        );
      })}
    </Paper>
  );
}
