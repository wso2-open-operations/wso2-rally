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

import { createContext, useContext } from "react";
import type { LocationReporter } from "@hooks/useLocationReporter";

/**
 * This phone's one position stream, held by `SessionLayout` so it keeps
 * reporting as the crew moves between screens.
 */
export const LocationReporterContext = createContext<LocationReporter | null>(null);

/**
 * Throws outside `SessionLayout` rather than handing back a reporter that
 * reports nothing: a screen whose "share" button silently did nothing would
 * look exactly like a phone that is sharing.
 */
export function useReporter(): LocationReporter {
  const reporter = useContext(LocationReporterContext);
  if (!reporter) {
    throw new Error("useReporter must be used inside SessionLayout");
  }

  return reporter;
}
