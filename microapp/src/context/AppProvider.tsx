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

import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type JSX, type ReactNode } from "react";
import theme from "@theme/index";

/**
 * Everything the app needs above the router: the theme and the query client.
 *
 * The client is created in state rather than at module scope so a test can
 * mount two independent trees without them sharing a cache.
 *
 * `retry: false` because this runs on a phone in a moving car: a request that
 * failed once is usually going to fail again, and a silent retry storm both
 * drains the battery and hides the outage from the crew. Screens surface the
 * failure and offer the action again.
 */
export default function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme} defaultMode="system">
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
