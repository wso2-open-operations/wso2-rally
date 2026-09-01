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

import { NULL_PLACEHOLDER } from "@constants/common";
import {
  SENSOR_LABELS,
  TRIGGER_LABELS,
  type RallyTask,
} from "@/types/task";

/**
 * What the A4 table shows in its Trigger column.
 *
 * A task with a sensor names the sensor rather than the trigger: "Accelerometer"
 * tells an organizer what the crew's phone has to do, where "Sensor" only
 * repeats the column heading. This is what the wireframe shows.
 *
 * @param {RallyTask} task - The task to describe.
 * @returns {string} The trigger or sensor label.
 */
export function formatTrigger(task: RallyTask): string {
  if (task.sensor && task.sensor !== "none") {
    return SENSOR_LABELS[task.sensor] ?? task.sensor;
  }

  return TRIGGER_LABELS[task.trigger] ?? task.trigger;
}

/**
 * What the A4 table shows in its Pts column.
 *
 * A rest lock awards nothing by design, and a branch can go either way, so
 * neither reads correctly as a plain number.
 *
 * @param {RallyTask} task - The task to describe.
 * @returns {string} The points label.
 */
export function formatPoints(task: RallyTask): string {
  if (task.type === "REST_LOCK" || task.points === 0) {
    return NULL_PLACEHOLDER;
  }
  if (task.type === "BRANCH") {
    return `±${Math.abs(task.points)}`;
  }

  return String(task.points);
}
