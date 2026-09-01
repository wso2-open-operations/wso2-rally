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

// Package vehicles owns the rally's cars and the crews riding in them, plus
// the CSV round trip organizers use to provision a hundred-odd teams without
// typing them in one at a time.
//
// In the rally's metaphor a vehicle is a data packet and each crew member is a
// node; the domain keeps the plainer names.
package vehicles

import (
	"fmt"
	"slices"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
)

// Sentinel errors, wrapping the shared categories.
var (
	// ErrNotFound means no vehicle exists with the requested id.
	ErrNotFound = fmt.Errorf("%w: vehicle", apperr.ErrNotFound)
	// ErrDuplicateCode means the event already has a vehicle with that code.
	ErrDuplicateCode = fmt.Errorf("%w: a vehicle with that code already exists in this event", apperr.ErrConflict)
)

// Status is a vehicle's health during the rally. Organizers see it on the
// dashboard and the live monitor.
type Status string

const (
	// StatusOK is a vehicle running normally.
	StatusOK Status = "ok"
	// StatusBreakdown is a mechanically stranded vehicle.
	StatusBreakdown Status = "breakdown"
	// StatusDeviceIssue is a vehicle whose in-car phone is failing.
	StatusDeviceIssue Status = "device_issue"
)

var allStatuses = []Status{StatusOK, StatusBreakdown, StatusDeviceIssue}

// IsValid reports whether s is a known vehicle status.
func (s Status) IsValid() bool { return slices.Contains(allStatuses, s) }

// CrewRole is a crew member's seat.
type CrewRole string

const (
	// RoleNavigator is the crew member holding the active phone.
	RoleNavigator CrewRole = "navigator"
	// RoleNode is any other crew member.
	RoleNode CrewRole = "node"
)

var allRoles = []CrewRole{RoleNavigator, RoleNode}

// IsValid reports whether r is a known crew role.
func (r CrewRole) IsValid() bool { return slices.Contains(allRoles, r) }

// CrewMember is one person in a vehicle.
type CrewMember struct {
	ID        string
	VehicleID string
	Name      string
	// Email is required. The in-car app is embedded in the super app, so a
	// joining phone presents an Asgardeo token and POST /sessions/join matches
	// its email claim against this — a member without one could never start.
	// Stored lowercased and trimmed so that match is a plain comparison.
	Email string
	// PhoneNumber is required so an organizer can call a car that goes quiet.
	// It stopped being a credential when the super app took over identity.
	PhoneNumber   string
	Role          CrewRole
	OriginCountry string
}

// Vehicle is one rally car with its crew.
type Vehicle struct {
	ID      string
	EventID string
	// Code is the organizer-facing identifier, e.g. PKT-001.
	Code          string
	TeamName      string
	VehicleType   string
	ContactNumber string
	// RouteID is empty until the vehicle is assigned a course.
	RouteID string
	Status  Status
	Crew    []CrewMember
}

// CreateVehicleInput is a request to provision a vehicle and its crew.
type CreateVehicleInput struct {
	EventID       string
	Code          string
	TeamName      string
	VehicleType   string
	ContactNumber string
	RouteID       string
	Crew          []CrewMemberInput
}

// CrewMemberInput is one crew member on a create or update request.
type CrewMemberInput struct {
	Name          string
	Email         string
	PhoneNumber   string
	Role          CrewRole
	OriginCountry string
}

// MinPhoneDigits is the fewest digits a crew phone number may carry.
//
// It is no longer a credential — the super app authenticates the person — but a
// number too short to dial is no use to an organizer chasing a silent car.
// Four is the floor rather than a full Sri Lankan number length because
// organizers paste numbers in whatever shape their spreadsheet holds, and
// rejecting a valid number on formatting grounds would be worse than accepting
// a short one.
const MinPhoneDigits = 4

// UpdateVehicleInput is a PATCH: nil fields are left untouched. A non-nil Crew
// replaces the whole crew list.
type UpdateVehicleInput struct {
	Code          *string
	TeamName      *string
	VehicleType   *string
	ContactNumber *string
	RouteID       *string
	Status        *Status
	Crew          *[]CrewMemberInput
}

// SearchFilter narrows a vehicle search. The zero value matches every vehicle
// of the event.
type SearchFilter struct {
	// Query matches the vehicle code or the team name, case-insensitively and
	// anywhere in the value — an organizer looking for a car mid-rally knows
	// "087" or "Dashers", not which column it lives in.
	Query string
	// RouteID restricts the result to one course.
	RouteID string
}

// ErrHasRun means the vehicle already has a rally session, so deleting it would
// take a crew's score, submissions and alerts with it.
var ErrHasRun = fmt.Errorf(
	"%w: this vehicle has already run, so it can be corrected but not deleted", apperr.ErrConflict)
