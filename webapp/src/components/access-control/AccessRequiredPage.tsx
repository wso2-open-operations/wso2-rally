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

import { Box, Button, Typography } from "@wso2/oxygen-ui";
import { ShieldAlert } from "@wso2/oxygen-ui-icons-react";
import { useAsgardeo } from "@asgardeo/react";
import type { JSX } from "react";

/**
 * Shown when the signed-in account is authenticated but is not a rally
 * organizer. Signing out is the only useful action, so it is the only one offered.
 *
 * @returns {JSX.Element} The access-required page.
 */
export default function AccessRequiredPage(): JSX.Element {
  const { signOut } = useAsgardeo();

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        textAlign: "center",
        py: 8,
      }}
    >
      <ShieldAlert size={48} />
      <Typography variant="h5">Organizer access required</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>
        Your account is signed in but is not a member of the rally organizer
        group. Ask a rally administrator to grant access, then sign in again.
      </Typography>
      <Button variant="outlined" onClick={() => void signOut()}>
        Sign out
      </Button>
    </Box>
  );
}
