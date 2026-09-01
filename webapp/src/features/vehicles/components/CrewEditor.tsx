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
  Button,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Plus, Trash2 } from "@wso2/oxygen-ui-icons-react";
import {
  CREW_ROLE_LABELS,
  MIN_PHONE_DIGITS,
  digitCount,
  emptyCrewMember,
  looksLikeEmail,
  type CrewMember,
  type CrewRole,
} from "@/types/vehicle";

export interface CrewEditorProps {
  crew: CrewMember[];
  disabled: boolean;
  onChange: (crew: CrewMember[]) => void;
}

/**
 * The crew roster inside the vehicle dialog.
 *
 * Each member's WSO2 email is required, and the helper text says why: the in-car
 * app is embedded in the super app, which signs them in, and the backend matches
 * that identity against this address. A blank one ships a roster that looks
 * provisioned and leaves someone stranded at the start line. The phone number is
 * required too, but only so an organizer can call a car that goes quiet.
 *
 * @param {CrewEditorProps} props - The roster, disabled state and change handler.
 * @returns {JSX.Element} The crew editor.
 */
export default function CrewEditor({
  crew,
  disabled,
  onChange,
}: CrewEditorProps): JSX.Element {
  const update = (index: number, patch: Partial<CrewMember>): void => {
    onChange(crew.map((member, at) => (at === index ? { ...member, ...patch } : member)));
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box sx={{ alignItems: "baseline", display: "flex", gap: 1 }}>
        <Typography variant="subtitle2">Crew</Typography>
        <Typography color="text.secondary" variant="caption">
          {crew.length === 0
            ? "No one yet — a car with no crew cannot be joined."
            : `${crew.length} ${crew.length === 1 ? "member" : "members"}`}
        </Typography>
      </Box>

      {crew.map((member, index) => {
        const digits = digitCount(member.phoneNumber);
        const isPhoneShort = member.phoneNumber.trim() !== "" && digits < MIN_PHONE_DIGITS;
        const isEmailWrong = member.email.trim() !== "" && !looksLikeEmail(member.email);

        return (
          <Box
            aria-label={`Crew member ${index + 1}`}
            key={index}
            role="group"
            sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}
          >
            <TextField
              disabled={disabled}
              label="Name"
              onChange={(changeEvent) => update(index, { name: changeEvent.target.value })}
              required
              size="small"
              sx={{ flex: "2 1 160px" }}
              value={member.name}
            />
            <TextField
              disabled={disabled}
              error={isEmailWrong}
              helperText={
                isEmailWrong ? "Their WSO2 address — it is how the in-car app knows them." : undefined
              }
              label="WSO2 email"
              onChange={(changeEvent) => update(index, { email: changeEvent.target.value })}
              required
              size="small"
              sx={{ flex: "2 1 200px" }}
              type="email"
              value={member.email}
            />
            <TextField
              disabled={disabled}
              error={isPhoneShort}
              helperText={
                isPhoneShort
                  ? `At least ${MIN_PHONE_DIGITS} digits, so organizers can reach the car.`
                  : undefined
              }
              label="Phone"
              onChange={(changeEvent) =>
                update(index, { phoneNumber: changeEvent.target.value })
              }
              required
              size="small"
              sx={{ flex: "2 1 150px" }}
              value={member.phoneNumber}
            />
            <TextField
              disabled={disabled}
              label="Role"
              onChange={(changeEvent) =>
                update(index, { role: changeEvent.target.value as CrewRole })
              }
              select
              size="small"
              sx={{ flex: "1 1 120px" }}
              value={member.role}
            >
              {Object.entries(CREW_ROLE_LABELS).map(([role, label]) => (
                <MenuItem key={role} value={role}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              disabled={disabled}
              label="Country"
              onChange={(changeEvent) =>
                update(index, { originCountry: changeEvent.target.value })
              }
              size="small"
              sx={{ flex: "1 1 90px" }}
              value={member.originCountry}
            />
            <Tooltip title="Remove from crew">
              <Box component="span">
                <IconButton
                  aria-label={`Remove crew member ${index + 1}`}
                  disabled={disabled}
                  onClick={() => onChange(crew.filter((_, at) => at !== index))}
                  size="small"
                >
                  <Trash2 size={16} />
                </IconButton>
              </Box>
            </Tooltip>
          </Box>
        );
      })}

      <Box>
        <Button
          disabled={disabled}
          onClick={() => onChange([...crew, emptyCrewMember()])}
          size="small"
          startIcon={<Plus size={14} />}
          type="button"
          variant="outlined"
        >
          Crew member
        </Button>
      </Box>
    </Box>
  );
}
