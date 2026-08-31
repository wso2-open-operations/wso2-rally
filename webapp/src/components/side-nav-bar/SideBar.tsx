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

import { Link, Sidebar } from "@wso2/oxygen-ui";
import { type JSX } from "react";
import { useLocation, Link as NavigateLink } from "react-router";
import { NAV_ITEMS, type NavItem } from "@constants/navConstants";

interface SideBarProps {
  collapsed: boolean;
  expandedMenus?: Record<string, boolean>;
  onSelect?: (id: string) => void;
  onToggleExpand?: (id: string) => void;
}

/**
 * The organizer sidebar.
 *
 * @param {SideBarProps} props - Collapse state and Oxygen shell callbacks.
 * @returns {JSX.Element} The sidebar.
 */
export default function SideBar({
  collapsed,
  expandedMenus,
  onSelect,
  onToggleExpand,
}: SideBarProps): JSX.Element {
  const location = useLocation();
  // The first path segment is the feature, so /events/:id/setup keeps Events lit.
  const activeItem = location.pathname.split("/").filter(Boolean)[0] ?? "events";

  return (
    <Sidebar
      collapsed={collapsed}
      activeItem={activeItem}
      expandedMenus={expandedMenus}
      onSelect={onSelect}
      onToggleExpand={onToggleExpand}
    >
      <Sidebar.Nav>
        <Sidebar.Category>
          {NAV_ITEMS.map((item: NavItem) => (
            <Link
              key={item.id}
              component={NavigateLink}
              to={item.path}
              color="inherit"
              underline="none"
            >
              <Sidebar.Item id={item.id}>
                <Sidebar.ItemIcon>
                  <item.icon size={20} />
                </Sidebar.ItemIcon>
                <Sidebar.ItemLabel>{item.label}</Sidebar.ItemLabel>
              </Sidebar.Item>
            </Link>
          ))}
        </Sidebar.Category>
      </Sidebar.Nav>
    </Sidebar>
  );
}
