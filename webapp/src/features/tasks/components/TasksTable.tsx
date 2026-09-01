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
import { CATEGORY_COLORS, TASK_TYPE_META, type RallyTask } from "@/types/task";
import { formatPoints, formatTrigger } from "@features/tasks/utils/taskFormat";

const COL_SPAN = 6;
const SKELETON_ROWS = 5;

export interface TasksTableProps {
  tasks: RallyTask[];
  isLoading: boolean;
  onEdit: (task: RallyTask) => void;
}

/**
 * The A4 task library: #, Task, Type, Trigger, Pts and the edit action.
 *
 * Rows arrive in natural code order (T1…T15) from the backend, so the table
 * does not re-sort them.
 *
 * @param {TasksTableProps} props - Rows, loading state and the edit handler.
 * @returns {JSX.Element} The tasks table.
 */
export default function TasksTable({
  tasks,
  isLoading,
  onEdit,
}: TasksTableProps): JSX.Element {
  return (
    <TableContainer component={Paper} sx={{ overflowX: "auto" }}>
      <Table sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 72 }}>#</TableCell>
            <TableCell>Task</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Trigger</TableCell>
            <TableCell align="right" sx={{ width: 80 }}>
              Pts
            </TableCell>
            <TableCell align="right" sx={{ width: 96 }} />
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
          ) : tasks.length === 0 ? (
            <TableRow>
              <TableCell align="center" colSpan={COL_SPAN}>
                <Typography color="text.secondary" variant="body2">
                  No tasks yet. Add the challenges crews will answer on the route.
                </Typography>
              </TableCell>
            </TableRow>
          ) : (
            tasks.map((task) => {
              const meta = TASK_TYPE_META[task.type];

              return (
                <TableRow key={task.id} hover>
                  <TableCell>
                    <Typography
                      color="text.secondary"
                      sx={{ fontFamily: "monospace" }}
                      variant="body2"
                    >
                      {task.code}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography fontWeight="medium" variant="body2">
                      {task.title}
                    </Typography>
                    {meta && (
                      <Typography color="text.secondary" variant="caption">
                        {meta.label}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {meta ? (
                      <Chip
                        color={CATEGORY_COLORS[meta.category]}
                        label={meta.category}
                        size="small"
                        sx={{ fontWeight: 500 }}
                        variant="outlined"
                      />
                    ) : (
                      // An unknown type means the backend grew one the web app
                      // has not learned yet; show it rather than hiding the row.
                      <Chip
                        color="default"
                        label={task.type}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography color="text.secondary" variant="body2">
                      {formatTrigger(task)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography sx={{ fontVariantNumeric: "tabular-nums" }} variant="body2">
                      {formatPoints(task)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      onClick={() => onEdit(task)}
                      size="small"
                      type="button"
                      variant="outlined"
                    >
                      Edit
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
