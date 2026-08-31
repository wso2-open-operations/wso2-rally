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

package events

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
)

// startTimeLayout is the "HH:MM" wall-clock format stored on an event.
const startTimeLayout = "15:04"

// Repo is the persistence contract. The service depends on this interface so
// its rules can be tested without a database.
type Repo interface {
	Create(ctx context.Context, e Event) error
	Get(ctx context.Context, id string) (Event, error)
	Update(ctx context.Context, e Event) error
	Search(ctx context.Context, page httpx.Page, filter SearchFilter) ([]Event, int, error)
	// Stats counts the event's fleet, crews, tasks and unresolved alerts.
	Stats(ctx context.Context, eventID string) (Stats, error)
}

// Service holds the event rules.
type Service struct {
	repo Repo
}

// NewService wires a Service to its repository.
func NewService(repo Repo) *Service {
	return &Service{repo: repo}
}

// Create validates and stores a new event. It always starts in setup: an event
// only becomes runnable through Publish.
func (s *Service) Create(ctx context.Context, in CreateEventInput) (Event, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.StartTime = strings.TrimSpace(in.StartTime)
	if err := validateCreate(in); err != nil {
		return Event{}, err
	}

	event := Event{
		ID:        store.NewID(),
		Name:      in.Name,
		EventDate: in.EventDate,
		StartTime: in.StartTime,
		Status:    StatusSetup,
		Start:     in.Start,
		End:       in.End,
		Cipher:    strings.TrimSpace(in.Cipher),
		CreatedBy: in.CreatedBy,
		CreatedOn: time.Now().UTC(),
	}
	if err := s.repo.Create(ctx, event); err != nil {
		return Event{}, fmt.Errorf("create event: %w", err)
	}

	return event, nil
}

// Get returns one event, or ErrNotFound.
func (s *Service) Get(ctx context.Context, id string) (Event, error) {
	return s.repo.Get(ctx, id)
}

// Update applies the non-nil fields of in and returns the stored result.
func (s *Service) Update(ctx context.Context, id string, in UpdateEventInput) (Event, error) {
	event, err := s.repo.Get(ctx, id)
	if err != nil {
		return Event{}, err
	}

	if in.Name != nil {
		event.Name = strings.TrimSpace(*in.Name)
	}
	if in.EventDate != nil {
		event.EventDate = *in.EventDate
	}
	if in.StartTime != nil {
		event.StartTime = strings.TrimSpace(*in.StartTime)
	}
	if in.Start != nil {
		event.Start = *in.Start
	}
	if in.End != nil {
		event.End = *in.End
	}
	if in.Cipher != nil {
		event.Cipher = strings.TrimSpace(*in.Cipher)
	}

	if err := validateEvent(event); err != nil {
		return Event{}, err
	}
	if err := s.repo.Update(ctx, event); err != nil {
		return Event{}, fmt.Errorf("update event %s: %w", id, err)
	}

	return event, nil
}

// Search returns a page of events plus the unpaged total.
func (s *Service) Search(ctx context.Context, page httpx.Page, filter SearchFilter) ([]Event, int, error) {
	if filter.Status != "" && !filter.Status.IsValid() {
		return nil, 0, fmt.Errorf("%w: unknown status %q", ErrValidation, filter.Status)
	}

	found, total, err := s.repo.Search(ctx, page, filter)
	if err != nil {
		return nil, 0, fmt.Errorf("search events: %w", err)
	}

	return found, total, nil
}

// Stats returns the dashboard counts for one event.
//
// The event is read first so an unknown id is a 404 rather than a row of
// zeroes, which would read as a provisioned-but-empty rally.
func (s *Service) Stats(ctx context.Context, id string) (Stats, error) {
	if _, err := s.repo.Get(ctx, id); err != nil {
		return Stats{}, err
	}

	stats, err := s.repo.Stats(ctx, id)
	if err != nil {
		return Stats{}, fmt.Errorf("stats of event %s: %w", id, err)
	}

	return stats, nil
}

// Publish moves an event from setup to active, opening it to crews.
//
// Both geofences must be placed first: without them the start grid cannot lock
// and arrival can never be detected, so the rally would be unrunnable.
func (s *Service) Publish(ctx context.Context, id string) (Event, error) {
	event, err := s.repo.Get(ctx, id)
	if err != nil {
		return Event{}, err
	}

	switch event.Status {
	case StatusActive:
		return event, nil // Publishing twice is a no-op, not an error.
	case StatusComplete:
		return Event{}, fmt.Errorf("%w: a completed event cannot be published again", ErrConflict)
	}

	if !event.Start.IsPlaced() || !event.End.IsPlaced() {
		return Event{}, fmt.Errorf("%w: both the start and end geofence must be placed before publishing", ErrValidation)
	}

	event.Status = StatusActive
	if err := s.repo.Update(ctx, event); err != nil {
		return Event{}, fmt.Errorf("publish event %s: %w", id, err)
	}

	return event, nil
}

func validateCreate(in CreateEventInput) error {
	if strings.TrimSpace(in.CreatedBy) == "" {
		return fmt.Errorf("%w: created by is required", ErrValidation)
	}

	return validateEvent(Event{
		Name:      in.Name,
		EventDate: in.EventDate,
		StartTime: in.StartTime,
		Start:     in.Start,
		End:       in.End,
	})
}

func validateEvent(e Event) error {
	if strings.TrimSpace(e.Name) == "" {
		return fmt.Errorf("%w: name is required", ErrValidation)
	}
	if e.EventDate.IsZero() {
		return fmt.Errorf("%w: event date is required", ErrValidation)
	}
	if err := validateStartTime(e.StartTime); err != nil {
		return err
	}
	if err := validateBoundary("start", e.Start); err != nil {
		return err
	}

	return validateBoundary("end", e.End)
}

func validateStartTime(value string) error {
	if value == "" {
		return fmt.Errorf("%w: start time is required", ErrValidation)
	}
	if _, err := time.Parse(startTimeLayout, value); err != nil {
		return fmt.Errorf("%w: start time must be HH:MM, got %q", ErrValidation, value)
	}

	return nil
}

func validateBoundary(name string, b Boundary) error {
	if b.Lat != nil && (*b.Lat < -90 || *b.Lat > 90) {
		return fmt.Errorf("%w: %s latitude must be between -90 and 90, got %s",
			ErrValidation, name, strconv.FormatFloat(*b.Lat, 'f', -1, 64))
	}
	if b.Lng != nil && (*b.Lng < -180 || *b.Lng > 180) {
		return fmt.Errorf("%w: %s longitude must be between -180 and 180, got %s",
			ErrValidation, name, strconv.FormatFloat(*b.Lng, 'f', -1, 64))
	}
	if b.RadiusM < 0 {
		return fmt.Errorf("%w: %s radius must not be negative, got %d", ErrValidation, name, b.RadiusM)
	}
	// A pin needs both halves of a coordinate to be usable.
	if (b.Lat == nil) != (b.Lng == nil) {
		return fmt.Errorf("%w: %s needs both a latitude and a longitude", ErrValidation, name)
	}

	return nil
}
