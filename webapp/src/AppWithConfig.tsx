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
import { BrowserRouter } from "react-router";
import { GlobalStyles, OxygenUIThemeProvider } from "@wso2/oxygen-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AsgardeoProvider } from "@asgardeo/react";
import { authConfig } from "@config/authConfig";
import { themeConfig } from "@config/themeConfig";
import { loggerConfig } from "@config/loggerConfig";
import LoggerProvider from "@context/logger/LoggerProvider";
import App from "./App";

/**
 * Retry policy for React Query.
 *
 * Only a gateway that could not reach the backend is worth retrying. A 4xx will
 * fail identically on every attempt, and a backend 500 is a real bug an
 * organizer should see rather than wait three times for.
 *
 * @param {number} failureCount - How many attempts have already failed.
 * @param {Error} error - The error the last attempt produced.
 * @returns {boolean} True when the request should be retried.
 */
function shouldRetry(failureCount: number, error: Error): boolean {
  if (failureCount >= 2) {
    return false;
  }

  const errorWithStatus = error as Error & {
    response?: { status?: number };
    status?: number;
  };
  const statusCode = errorWithStatus.response?.status || errorWithStatus.status;

  return statusCode === 502 || statusCode === 503;
}

const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: true,
    },
    // Reads retry; writes do not. A 502 or 503 says the gateway could not
    // reach the service or could not relay its answer — not that the write was
    // rejected. The backend mints a fresh id per insert and takes no
    // idempotency key, so retrying a create that actually succeeded produces a
    // second event. Give a write a retry only where it can prove it is safe.
    mutations: {
      retry: false,
    },
  },
});

export default function AppWithConfig(): JSX.Element {
  return (
    <AsgardeoProvider
      baseUrl={authConfig.baseUrl}
      clientId={authConfig.clientId}
      afterSignInUrl={authConfig.signInRedirectURL}
      afterSignOutUrl={authConfig.signOutRedirectURL}
      // Keeps the organizer signed in for the length of an event; without it
      // they start collecting 401s mid-rally.
      //
      // The suppression is the SDK's, not ours: @asgardeo/react 0.25.6 honours
      // this at runtime — dist/index.js resolves
      // `tokenLifecycle?.refreshToken?.autoRefresh ?? config?.periodicTokenRefresh`
      // — but its published dist/index.d.ts declares no token-refresh option at
      // all, so there is nothing to type against.
      //
      // On the next SDK bump: if the types have caught up, prefer the newer
      // `tokenLifecycle.refreshToken.autoRefresh` key, which is checked first,
      // and delete this.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      periodicTokenRefresh
      scopes={["openid", "email", "groups", "profile"]}
      preferences={{
        theme: {
          inheritFromBranding: false,
        },
        user: {
          fetchUserProfile: false,
          fetchOrganizations: false,
        },
      }}
    >
      <BrowserRouter>
        <LoggerProvider config={loggerConfig}>
          <OxygenUIThemeProvider theme={themeConfig}>
            <GlobalStyles
              styles={{
                "html, body, #root": {
                  width: "100%",
                  maxWidth: "100vw",
                  overflowX: "clip",
                },
              }}
            />
            <QueryClientProvider client={queryClient}>
              <App />
              <ReactQueryDevtools initialIsOpen={false} />
            </QueryClientProvider>
          </OxygenUIThemeProvider>
        </LoggerProvider>
      </BrowserRouter>
    </AsgardeoProvider>
  );
}
