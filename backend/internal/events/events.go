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

// Package events owns the rally event: its date, its 09:00 start, and the two
// geofences that bracket the course.
//
// It is the reference layout for every CRUD domain in this backend:
// <name>.go holds the domain types and enums, repo.go the SQL, service.go the
// rules, and handler.go the HTTP surface.
package events

import (
	"fmt"
	"time"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
)

// Sentinel errors. They wrap the shared apperr categories, so a caller can
// match either the specific error or its category, and httpx.WriteDomainError
// maps them onto status codes without knowing this package.
var (
	// ErrNotFound means no event exists with the requested id.
	ErrNotFound = fmt.Errorf("%w: event", apperr.ErrNotFound)
	// ErrValidation means the caller sent something unusable. Wrapped errors
	// carry a client-safe explanation.
	ErrValidation = apperr.ErrValidation
	// ErrConflict means the event's current status forbids the action.
	ErrConflict = apperr.ErrConflict
)

// Status is an event's lifecycle stage.
type Status string

const (
	// StatusSetup is an event being authored. Only setup events are editable.
	StatusSetup Status = "setup"
	// StatusActive is a published event: crews may bind and run it.
	StatusActive Status = "active"
	// StatusComplete is a finished event, kept read-only for the leaderboard.
	StatusComplete Status = "complete"
)

// IsValid reports whether s is one of the three known statuses.
func (s Status) IsValid() bool {
	switch s {
	case StatusSetup, StatusActive, StatusComplete:
		return true
	default:
		return false
	}
}

// Boundary is a named circular geofence. Lat and Lng are pointers because an
// organizer saves an event before dropping its pins on the map.
type Boundary struct {
	Label   string
	Lat     *float64
	Lng     *float64
	RadiusM int
}

// IsPlaced reports whether the boundary has coordinates and can be evaluated.
func (b Boundary) IsPlaced() bool { return b.Lat != nil && b.Lng != nil }

// RouteRef names one of an event's routes. It is the smallest projection the
// events dashboard needs — the routes domain owns the full shape.
type RouteRef struct {
	ID   string
	Name string
}

// Event is the domain model. Times are typed; the wire shape lives in dto.go.
type Event struct {
	ID        string
	Name      string
	EventDate time.Time
	// StartTime is the local wall-clock start in "HH:MM" — the moment the
	// synchronised start signal goes out to every bound phone.
	StartTime string
	Status    Status
	Start     Boundary
	End       Boundary
	// Cipher is revealed to all crews on the start signal.
	Cipher    string
	CreatedBy string
	CreatedOn time.Time
	// Routes is a read-only projection filled by Get and Search so the events
	// table can print "Inland + Wetlands" without a call per row. Create and
	// Update ignore it; routes are written through the routes domain.
	Routes []RouteRef
}

// Stats are the headline counts behind the events dashboard cards.
type Stats struct {
	Vehicles int
	Crews    int
	Tasks    int
	// OpenAlerts counts unresolved alerts across the event's whole fleet.
	OpenAlerts int
}

// CreateEventInput is a validated create request.
type CreateEventInput struct {
	Name      string
	EventDate time.Time
	StartTime string
	Start     Boundary
	End       Boundary
	Cipher    string
	CreatedBy string
}

// UpdateEventInput is a PATCH: a nil field is left untouched.
type UpdateEventInput struct {
	Name      *string
	EventDate *time.Time
	StartTime *string
	Start     *Boundary
	End       *Boundary
	Cipher    *string
}

// SearchFilter narrows a search. A zero value matches every event.
type SearchFilter struct {
	Status Status
}
