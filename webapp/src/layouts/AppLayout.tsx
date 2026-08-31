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

import { type JSX, type ReactNode, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import {
  Box,
  LinearProgress,
  Typography,
  useAppShell,
  useMediaQuery,
  useTheme,
} from "@wso2/oxygen-ui";
import { useAsgardeo } from "@asgardeo/react";
import AppShellLayout from "@layouts/AppShellLayout";
import Header from "@components/header/Header";
import Footer from "@components/footer/Footer";
import SideBar from "@components/side-nav-bar/SideBar";
import { useLoader } from "@context/linear-loader/useLoader";
import { useGetCurrentUser } from "@api/useCurrentUser";
import AccessRequiredPage from "@components/access-control/AccessRequiredPage";
import { isForbiddenError, isUnauthorizedError } from "@utils/ApiError";

interface AppLayoutProps {
  children?: ReactNode;
}

/**
 * The authenticated shell: header, sidebar, footer and the routed page.
 *
 * @param {AppLayoutProps} props - Optional children, used in place of the outlet.
 * @returns {JSX.Element} The app layout.
 */
export default function AppLayout({ children }: AppLayoutProps): JSX.Element {
  const location = useLocation();
  const { isLoading: isAuthLoading } = useAsgardeo();
  const { error: currentUserError, isLoading: isCurrentUserLoading } =
    useGetCurrentUser();
  const { isVisible } = useLoader();

  const theme = useTheme();
  const isCompactViewport = useMediaQuery(theme.breakpoints.down("md"));
  const { state: shellState, actions: shellActions } = useAppShell({
    initialCollapsed: isCompactViewport,
  });

  // Route changes scroll the shell, not the window: the page body is the only
  // scrolling element in this layout.
  useEffect(() => {
    document.getElementById("main-scroll-container")?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Collapse when the viewport shrinks below md, but never fight a manual expand.
  const wasCompactViewport = useRef(isCompactViewport);
  useEffect(() => {
    if (
      isCompactViewport &&
      !wasCompactViewport.current &&
      !shellState.sidebarCollapsed
    ) {
      shellActions.toggleSidebar();
    }
    wasCompactViewport.current = isCompactViewport;
  }, [isCompactViewport, shellState.sidebarCollapsed, shellActions]);

  // Latched, not derived: once auth and the identity call have both settled the
  // shell must stay rendered. Deriving it from the live flags would flash the
  // loading state again on every background refetch. Adjusting state during
  // render (rather than in an effect) avoids a second render pass.
  const [hasInitialized, setHasInitialized] = useState(false);
  if (!hasInitialized && !isAuthLoading && !isCurrentUserLoading) {
    setHasInitialized(true);
  }

  // A token Asgardeo accepts but the backend rejects means the account is not
  // an organizer — that is an access problem, not a broken page.
  const hasAccessError =
    isUnauthorizedError(currentUserError) || isForbiddenError(currentUserError);

  const isSidebarOverlay = isCompactViewport;
  const isSidebarOpen = isSidebarOverlay && !shellState.sidebarCollapsed;

  const handleSidebarClose = (): void => {
    if (!shellState.sidebarCollapsed) {
      shellActions.toggleSidebar();
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        overflow: "hidden",
      }}
    >
      <AppShellLayout
        header={
          <Header
            onToggleSidebar={shellActions.toggleSidebar}
            collapsed={shellState.sidebarCollapsed}
          />
        }
        sidebar={
          hasAccessError ? undefined : (
            <SideBar
              collapsed={isSidebarOverlay ? false : shellState.sidebarCollapsed}
              expandedMenus={shellState.expandedMenus}
              onSelect={shellActions.setActiveMenuItem}
              onToggleExpand={shellActions.toggleMenu}
            />
          )
        }
        sidebarOverlay={isSidebarOverlay}
        sidebarOpen={isSidebarOpen}
        onSidebarClose={handleSidebarClose}
        footer={<Footer />}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            maxWidth: "100%",
            position: "relative",
            boxSizing: "border-box",
          }}
        >
          {isVisible && (
            <LinearProgress
              color="warning"
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                zIndex: 1300,
                height: 3,
              }}
            />
          )}
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              width: "100%",
              maxWidth: "100%",
              display: "flex",
              flexDirection: "column",
              boxSizing: "border-box",
              px: { xs: 1.5, sm: 2, md: 3 },
              py: { xs: 2, sm: 2.5, md: 3 },
            }}
          >
            {!hasInitialized ? (
              <Box
                sx={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                }}
              >
                <LinearProgress
                  color="warning"
                  sx={{ width: "80%", maxWidth: 400, height: 4 }}
                />
                <Typography variant="body2" color="text.secondary">
                  Loading…
                </Typography>
              </Box>
            ) : hasAccessError ? (
              <AccessRequiredPage />
            ) : (
              <Box sx={{ width: "100%", maxWidth: "100%", minWidth: 0, flex: 1 }}>
                {children || <Outlet />}
              </Box>
            )}
          </Box>
        </Box>
      </AppShellLayout>
    </Box>
  );
}
