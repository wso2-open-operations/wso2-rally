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

package vehicles

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
)

// Repo is the persistence contract for vehicles and their crews.
type Repo interface {
	Create(ctx context.Context, v Vehicle) error
	// CreateMany inserts a batch atomically, for CSV import.
	CreateMany(ctx context.Context, list []Vehicle) error
	Get(ctx context.Context, id string) (Vehicle, error)
	Update(ctx context.Context, v Vehicle) error
	Delete(ctx context.Context, id string) error
	// HasRun reports whether the vehicle has any rally session, live or
	// finished. A vehicle that has one cannot be deleted.
	HasRun(ctx context.Context, vehicleID string) (bool, error)
	Search(ctx context.Context, eventID string, filter SearchFilter, page httpx.Page) ([]Vehicle, int, error)
	// ListByEvent returns every vehicle of an event, for CSV export.
	ListByEvent(ctx context.Context, eventID string) ([]Vehicle, error)
	SetStatus(ctx context.Context, vehicleID string, status Status) error
	// RouteNamesByID maps an event's route ids to names, for CSV export.
	RouteNamesByID(ctx context.Context, eventID string) (map[string]string, error)
	// RouteIDsByName is the inverse, for CSV import.
	RouteIDsByName(ctx context.Context, eventID string) (map[string]string, error)
}

// Service holds the vehicle and crew rules.
type Service struct {
	repo Repo
}

// NewService wires a Service to its repository.
func NewService(repo Repo) *Service {
	return &Service{repo: repo}
}

// Create provisions a vehicle and its crew.
func (s *Service) Create(ctx context.Context, in CreateVehicleInput) (Vehicle, error) {
	vehicle, err := buildVehicle(in)
	if err != nil {
		return Vehicle{}, err
	}

	if err := s.repo.Create(ctx, vehicle); err != nil {
		return Vehicle{}, fmt.Errorf("create vehicle: %w", err)
	}

	return vehicle, nil
}

// Get returns one vehicle with its crew, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id string) (Vehicle, error) {
	return s.repo.Get(ctx, id)
}

// Update applies the non-nil fields of in. A non-nil Crew replaces the whole
// crew list, which is how the organizer UI saves the crew editor.
func (s *Service) Update(ctx context.Context, id string, in UpdateVehicleInput) (Vehicle, error) {
	vehicle, err := s.repo.Get(ctx, id)
	if err != nil {
		return Vehicle{}, err
	}

	if in.Code != nil {
		vehicle.Code = strings.TrimSpace(*in.Code)
	}
	if in.TeamName != nil {
		vehicle.TeamName = strings.TrimSpace(*in.TeamName)
	}
	if in.VehicleType != nil {
		vehicle.VehicleType = strings.TrimSpace(*in.VehicleType)
	}
	if in.ContactNumber != nil {
		vehicle.ContactNumber = strings.TrimSpace(*in.ContactNumber)
	}
	if in.RouteID != nil {
		vehicle.RouteID = strings.TrimSpace(*in.RouteID)
	}
	if in.Status != nil {
		vehicle.Status = *in.Status
	}
	if in.Crew != nil {
		crew, err := buildCrew(vehicle.ID, *in.Crew)
		if err != nil {
			return Vehicle{}, err
		}
		vehicle.Crew = crew
	}

	if err := validateVehicle(vehicle); err != nil {
		return Vehicle{}, err
	}
	if err := s.repo.Update(ctx, vehicle); err != nil {
		return Vehicle{}, fmt.Errorf("update vehicle %s: %w", id, err)
	}

	return vehicle, nil
}

// Search returns a page of an event's vehicles plus the unpaged total. The
// total counts what the filter matched, not the whole fleet, so a filtered
// table pages through its own results.
func (s *Service) Search(
	ctx context.Context, eventID string, filter SearchFilter, page httpx.Page,
) ([]Vehicle, int, error) {
	if eventID == "" {
		return nil, 0, apperr.Validationf("event id is required")
	}

	filter.Query = strings.TrimSpace(filter.Query)

	found, total, err := s.repo.Search(ctx, eventID, filter, page)
	if err != nil {
		return nil, 0, fmt.Errorf("search vehicles of event %s: %w", eventID, err)
	}

	return found, total, nil
}

// Delete removes a vehicle that should not have been provisioned.
//
// It refuses once the vehicle has run. Every session, submission, score and
// alert hangs off the vehicle row by a cascading foreign key, so deleting one
// mid- or post-rally would quietly erase a result instead of fixing a typo —
// retire the car by other means and keep its history.
func (s *Service) Delete(ctx context.Context, vehicleID string) error {
	if _, err := s.repo.Get(ctx, vehicleID); err != nil {
		return err
	}

	hasRun, err := s.repo.HasRun(ctx, vehicleID)
	if err != nil {
		return fmt.Errorf("check sessions of vehicle %s: %w", vehicleID, err)
	}
	if hasRun {
		return ErrHasRun
	}

	if err := s.repo.Delete(ctx, vehicleID); err != nil {
		return fmt.Errorf("delete vehicle %s: %w", vehicleID, err)
	}

	return nil
}

// SetStatus records a vehicle's health. The alerts service calls it when a
// breakdown or device issue is raised, so the dashboard and live monitor agree.
func (s *Service) SetStatus(ctx context.Context, vehicleID string, status Status) error {
	if !status.IsValid() {
		return apperr.Validationf("unknown vehicle status %q", status)
	}

	if err := s.repo.SetStatus(ctx, vehicleID, status); err != nil {
		return fmt.Errorf("set status of vehicle %s: %w", vehicleID, err)
	}

	return nil
}

// ImportCSV provisions a batch of vehicles from the organizer's spreadsheet
// and reports how many were created.
//
// The whole file is validated before anything is written, and the insert runs
// in one transaction: a typo on line 80 must not leave 79 vehicles behind.
func (s *Service) ImportCSV(ctx context.Context, eventID string, r io.Reader) (int, error) {
	if eventID == "" {
		return 0, apperr.Validationf("event id is required")
	}

	rows, err := parseCSV(r)
	if err != nil {
		return 0, err
	}

	routeIDs, err := s.repo.RouteIDsByName(ctx, eventID)
	if err != nil {
		return 0, fmt.Errorf("load routes of event %s: %w", eventID, err)
	}

	seen := make(map[string]struct{}, len(rows))
	list := make([]Vehicle, 0, len(rows))
	for i, row := range rows {
		line := i + 2 // Header is line 1.
		if _, duplicate := seen[row.Code]; duplicate {
			return 0, apperr.Validationf("vehicle code %q appears more than once, at line %d", row.Code, line)
		}
		seen[row.Code] = struct{}{}

		routeID := ""
		if row.RouteName != "" {
			id, ok := routeIDs[row.RouteName]
			if !ok {
				return 0, apperr.Validationf("line %d names route %q, which does not exist in this event",
					line, row.RouteName)
			}
			routeID = id
		}

		in := CreateVehicleInput{
			EventID:       eventID,
			Code:          row.Code,
			TeamName:      row.TeamName,
			VehicleType:   row.VehicleType,
			ContactNumber: row.ContactNumber,
			RouteID:       routeID,
		}
		in.Crew = append(in.Crew, row.Crew...)
		for i := range in.Crew {
			in.Crew[i].Role = RoleNode
		}
		// The first crew member listed is the expected navigator. Roster
		// metadata only — every phone in the car has the same powers once joined.
		if len(in.Crew) > 0 {
			in.Crew[0].Role = RoleNavigator
		}

		vehicle, err := buildVehicle(in)
		if err != nil {
			return 0, fmt.Errorf("line %d: %w", line, err)
		}
		list = append(list, vehicle)
	}

	if err := s.repo.CreateMany(ctx, list); err != nil {
		return 0, fmt.Errorf("import vehicles: %w", err)
	}

	return len(list), nil
}

// ExportCSV writes an event's vehicles in the same shape ImportCSV reads.
func (s *Service) ExportCSV(ctx context.Context, eventID string, w io.Writer) error {
	if eventID == "" {
		return apperr.Validationf("event id is required")
	}

	list, err := s.repo.ListByEvent(ctx, eventID)
	if err != nil {
		return fmt.Errorf("list vehicles of event %s: %w", eventID, err)
	}
	routeNames, err := s.repo.RouteNamesByID(ctx, eventID)
	if err != nil {
		return fmt.Errorf("load routes of event %s: %w", eventID, err)
	}

	return writeCSV(w, list, routeNames)
}

func buildVehicle(in CreateVehicleInput) (Vehicle, error) {
	vehicle := Vehicle{
		ID:            store.NewID(),
		EventID:       in.EventID,
		Code:          strings.TrimSpace(in.Code),
		TeamName:      strings.TrimSpace(in.TeamName),
		VehicleType:   strings.TrimSpace(in.VehicleType),
		ContactNumber: strings.TrimSpace(in.ContactNumber),
		RouteID:       strings.TrimSpace(in.RouteID),
		Status:        StatusOK,
	}

	crew, err := buildCrew(vehicle.ID, in.Crew)
	if err != nil {
		return Vehicle{}, err
	}
	vehicle.Crew = crew

	if vehicle.EventID == "" {
		return Vehicle{}, apperr.Validationf("event id is required")
	}
	if err := validateVehicle(vehicle); err != nil {
		return Vehicle{}, err
	}

	return vehicle, nil
}

func buildCrew(vehicleID string, inputs []CrewMemberInput) ([]CrewMember, error) {
	crew := make([]CrewMember, 0, len(inputs))
	seenEmails := make(map[string]string, len(inputs))
	for _, in := range inputs {
		name := strings.TrimSpace(in.Name)
		if name == "" {
			return nil, apperr.Validationf("crew member name is required")
		}
		email, err := normalizeCrewEmail(name, in.Email)
		if err != nil {
			return nil, err
		}
		// Two people in one car cannot share an address: a join would not know
		// which of them was calling.
		if other, taken := seenEmails[email]; taken {
			return nil, apperr.Validationf(
				"crew members %q and %q cannot share the address %s", other, name, email)
		}
		seenEmails[email] = name

		phone := strings.TrimSpace(in.PhoneNumber)
		if err := validatePhoneNumber(name, phone); err != nil {
			return nil, err
		}
		role := in.Role
		if role == "" {
			role = RoleNode
		}
		if !role.IsValid() {
			return nil, apperr.Validationf("unknown crew role %q", in.Role)
		}
		crew = append(crew, CrewMember{
			ID:            store.NewID(),
			VehicleID:     vehicleID,
			Name:          name,
			Email:         email,
			PhoneNumber:   phone,
			Role:          role,
			OriginCountry: strings.TrimSpace(in.OriginCountry),
		})
	}

	return crew, nil
}

// normalizeCrewEmail lowercases, trims and sanity-checks a crew address.
//
// Stored normalized so the join match is a plain comparison rather than a
// case-folding one in SQL. The shape check is deliberately shallow — one `@`
// with something either side — because a stricter rule rejects real addresses,
// and the address is proved by Asgardeo at join time, not by this validation.
// The member's name is in every message: a rejected CSV of 150 rows is useless
// without it.
func normalizeCrewEmail(name, email string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(email))
	if normalized == "" {
		return "", apperr.Validationf(
			"crew member %q needs a WSO2 email address — it is how the in-car app recognises them", name)
	}

	local, domain, found := strings.Cut(normalized, "@")
	if !found || local == "" || domain == "" || strings.ContainsAny(normalized, " \t") {
		return "", apperr.Validationf("crew member %q has %q, which is not an email address", name, email)
	}

	return normalized, nil
}

// validatePhoneNumber requires a number an organizer could actually dial.
//
// Only digits are counted, so any punctuation an organizer's spreadsheet
// carries is fine — what is rejected is a number too short to call. The
// member's name is in the message because a rejected CSV of 150 rows is
// useless without it.
func validatePhoneNumber(name, phone string) error {
	digits := 0
	for _, r := range phone {
		if r >= '0' && r <= '9' {
			digits++
		}
	}
	if digits < MinPhoneDigits {
		return apperr.Validationf(
			"crew member %q needs a phone number of at least %d digits so organizers can reach the car",
			name, MinPhoneDigits)
	}

	return nil
}

func validateVehicle(v Vehicle) error {
	if v.Code == "" {
		return apperr.Validationf("vehicle code is required")
	}
	if v.TeamName == "" {
		return apperr.Validationf("team name is required")
	}
	if !v.Status.IsValid() {
		return apperr.Validationf("unknown vehicle status %q", v.Status)
	}

	return nil
}
