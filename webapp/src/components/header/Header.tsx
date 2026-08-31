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

import { useState, type JSX, type MouseEvent } from "react";
import {
  Box,
  Divider,
  Header as HeaderUI,
  IconButton,
  Menu,
  MenuItem,
  Typography,
} from "@wso2/oxygen-ui";
import { LogOut, UserRound } from "@wso2/oxygen-ui-icons-react";
import { useAsgardeo } from "@asgardeo/react";
import { useNavigate } from "react-router";
import { useGetCurrentUser } from "@api/useCurrentUser";

interface HeaderProps {
  onToggleSidebar: () => void;
  collapsed?: boolean;
}

/**
 * The app header: sidebar toggle, product mark and the signed-in organizer.
 *
 * @param {HeaderProps} props - Sidebar toggle state and handler.
 * @returns {JSX.Element} The header.
 */
export default function Header({
  onToggleSidebar,
  collapsed = false,
}: HeaderProps): JSX.Element {
  const navigate = useNavigate();
  const { signOut } = useAsgardeo();
  const { data: currentUser } = useGetCurrentUser();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const handleOpen = (event: MouseEvent<HTMLElement>): void =>
    setAnchorEl(event.currentTarget);
  const handleClose = (): void => setAnchorEl(null);

  return (
    <HeaderUI sx={{ width: "100%", maxWidth: "100%", overflow: "hidden" }}>
      <HeaderUI.Toggle collapsed={collapsed} onToggle={onToggleSidebar} />
      <Box
        onClick={() => void navigate("/events")}
        sx={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 1 }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
          Rally Ops
        </Typography>
      </Box>
      <HeaderUI.Spacer />
      <IconButton
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchorEl)}
        aria-controls="header-account-menu"
        onClick={handleOpen}
        size="small"
      >
        <UserRound size={20} />
      </IconButton>
      <Menu
        id="header-account-menu"
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {currentUser?.email ?? "Signed in"}
          </Typography>
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            handleClose();
            void signOut();
          }}
        >
          <LogOut size={16} style={{ marginRight: 8 }} />
          Sign out
        </MenuItem>
      </Menu>
    </HeaderUI>
  );
}
