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
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Pencil, Trash2 } from "@wso2/oxygen-ui-icons-react";
import type { RallyRoute } from "@/types/route";
import { VEHICLE_STATUS_META, type Vehicle } from "@/types/vehicle";

const COL_SPAN = 7;
const SKELETON_ROWS = 5;

export interface VehiclesTableProps {
  vehicles: Vehicle[];
  /** The event's routes, for turning `routeId` into a course name. */
  routes: RallyRoute[];
  isLoading: boolean;
  onEdit: (vehicle: Vehicle) => void;
  onDelete: (vehicle: Vehicle) => void;
}

/**
 * The A5 fleet table: Vehicle, Team, Crew, Contact, Type, Route.
 *
 * Rows arrive ordered by code from the backend, so the table does not re-sort
 * them.
 *
 * @param {VehiclesTableProps} props - Rows, routes, loading state and handlers.
 * @returns {JSX.Element} The vehicles table.
 */
export default function VehiclesTable({
  vehicles,
  routes,
  isLoading,
  onEdit,
  onDelete,
}: VehiclesTableProps): JSX.Element {
  const routeNameById = new Map(routes.map((route) => [route.id, route.name]));

  return (
    <TableContainer component={Paper} sx={{ overflowX: "auto" }}>
      <Table sx={{ minWidth: 820 }}>
        <TableHead>
          <TableRow>
            <TableCell>Vehicle</TableCell>
            <TableCell>Team</TableCell>
            <TableCell align="right" sx={{ width: 72 }}>
              Crew
            </TableCell>
            <TableCell>Contact</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Route</TableCell>
            <TableCell align="right" sx={{ width: 104 }} />
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
          ) : vehicles.length === 0 ? (
            <TableRow>
              <TableCell align="center" colSpan={COL_SPAN}>
                <Typography color="text.secondary" variant="body2">
                  No vehicles yet. Add a car, or import the fleet from a CSV —
                  these records are what the in-car app offers crews at the start
                  line.
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            vehicles.map((vehicle) => {
              const routeName = routeNameById.get(vehicle.routeId);
              const status = VEHICLE_STATUS_META[vehicle.status];

              return (
                <TableRow hover key={vehicle.id}>
                  <TableCell>
                    <Box sx={{ alignItems: "center", display: "flex", gap: 1 }}>
                      <Typography
                        sx={{ fontFamily: "monospace" }}
                        variant="body2"
                      >
                        {vehicle.code}
                      </Typography>
                      {vehicle.status !== "ok" && status && (
                        <Chip
                          color={status.color}
                          label={status.label}
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography fontWeight="medium" variant="body2">
                      {vehicle.teamName}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography
                      color={vehicle.crew.length === 0 ? "warning.main" : "text.primary"}
                      sx={{ fontVariantNumeric: "tabular-nums" }}
                      variant="body2"
                    >
                      {vehicle.crew.length}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography color="text.secondary" variant="body2">
                      {vehicle.contactNumber || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography color="text.secondary" variant="body2">
                      {vehicle.vehicleType || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {routeName ? (
                      <Chip label={routeName} size="small" variant="outlined" />
                    ) : (
                      <Typography color="text.secondary" variant="caption">
                        Unassigned
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton
                        aria-label={`Edit ${vehicle.code}`}
                        onClick={() => onEdit(vehicle)}
                        size="small"
                      >
                        <Pencil size={16} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove">
                      <IconButton
                        aria-label={`Remove ${vehicle.code}`}
                        onClick={() => onDelete(vehicle)}
                        size="small"
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </Tooltip>
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
