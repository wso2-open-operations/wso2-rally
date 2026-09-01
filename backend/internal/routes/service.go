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

package routes

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
)

// Repo is the persistence contract for routes and their waypoints.
type Repo interface {
	CreateRoute(ctx context.Context, r Route) error
	GetRoute(ctx context.Context, id string) (Route, error)
	ListRoutes(ctx context.Context, eventID string) ([]Route, error)
	UpdateRoute(ctx context.Context, r Route) error

	ListWaypoints(ctx context.Context, routeID string) ([]Waypoint, error)
	GetWaypoint(ctx context.Context, id string) (Waypoint, error)
	CreateWaypoint(ctx context.Context, w Waypoint) error
	UpdateWaypoint(ctx context.Context, w Waypoint) error
	// DeleteWaypoint removes the waypoint and renumbers what is left of the
	// route, both in one transaction.
	DeleteWaypoint(ctx context.Context, routeID, waypointID string) error
	// ReorderWaypoints rewrites display_order for the whole route atomically.
	ReorderWaypoints(ctx context.Context, routeID string, orderedIDs []string) error
	// AttachTasks replaces the waypoint's task attachments with taskIDs.
	AttachTasks(ctx context.Context, waypointID string, taskIDs []string) error
}

// Service holds the route and waypoint rules.
type Service struct {
	repo Repo
}

// NewService wires a Service to its repository.
func NewService(repo Repo) *Service {
	return &Service{repo: repo}
}

// CreateRoute adds a named course to an event.
func (s *Service) CreateRoute(ctx context.Context, in CreateRouteInput) (Route, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.EventID == "" {
		return Route{}, apperr.Validationf("event id is required")
	}
	if in.Name == "" {
		return Route{}, apperr.Validationf("route name is required")
	}

	route := Route{ID: store.NewID(), EventID: in.EventID, Name: in.Name, Order: in.Order}
	if err := s.repo.CreateRoute(ctx, route); err != nil {
		return Route{}, fmt.Errorf("create route: %w", err)
	}

	return route, nil
}

// GetRoute returns a route with its waypoints in driving order, each carrying
// the ids of the tasks attached to it.
func (s *Service) GetRoute(ctx context.Context, routeID string) (Route, error) {
	route, err := s.repo.GetRoute(ctx, routeID)
	if err != nil {
		return Route{}, err
	}

	waypoints, err := s.repo.ListWaypoints(ctx, routeID)
	if err != nil {
		return Route{}, fmt.Errorf("list waypoints of route %s: %w", routeID, err)
	}
	route.Waypoints = waypoints

	return route, nil
}

// ListRoutes returns an event's routes, without their waypoints.
func (s *Service) ListRoutes(ctx context.Context, eventID string) ([]Route, error) {
	if eventID == "" {
		return nil, apperr.Validationf("event id is required")
	}

	found, err := s.repo.ListRoutes(ctx, eventID)
	if err != nil {
		return nil, fmt.Errorf("list routes of event %s: %w", eventID, err)
	}

	return found, nil
}

// UpdateRoute applies the non-nil fields of in.
func (s *Service) UpdateRoute(ctx context.Context, routeID string, in UpdateRouteInput) (Route, error) {
	route, err := s.repo.GetRoute(ctx, routeID)
	if err != nil {
		return Route{}, err
	}

	if in.Name != nil {
		route.Name = strings.TrimSpace(*in.Name)
		if route.Name == "" {
			return Route{}, apperr.Validationf("route name is required")
		}
	}
	if in.Order != nil {
		route.Order = *in.Order
	}

	if err := s.repo.UpdateRoute(ctx, route); err != nil {
		return Route{}, fmt.Errorf("update route %s: %w", routeID, err)
	}

	return route, nil
}

// AddWaypoint appends a waypoint to the end of a route.
func (s *Service) AddWaypoint(ctx context.Context, in AddWaypointInput) (Waypoint, error) {
	in.Label = strings.TrimSpace(in.Label)
	if err := validateWaypoint(in.Label, in.Lat, in.Lng, in.BoundaryRadiusM); err != nil {
		return Waypoint{}, err
	}

	// Confirm the route exists so a typo cannot orphan a waypoint behind the
	// foreign key's less helpful error.
	if _, err := s.repo.GetRoute(ctx, in.RouteID); err != nil {
		return Waypoint{}, err
	}

	existing, err := s.repo.ListWaypoints(ctx, in.RouteID)
	if err != nil {
		return Waypoint{}, fmt.Errorf("list waypoints of route %s: %w", in.RouteID, err)
	}

	waypoint := Waypoint{
		ID:              store.NewID(),
		RouteID:         in.RouteID,
		Order:           len(existing),
		Label:           in.Label,
		Lat:             in.Lat,
		Lng:             in.Lng,
		BoundaryRadiusM: in.BoundaryRadiusM,
	}
	if err := s.repo.CreateWaypoint(ctx, waypoint); err != nil {
		return Waypoint{}, fmt.Errorf("create waypoint: %w", err)
	}

	return waypoint, nil
}

// GetWaypoint returns one waypoint with the ids of its attached tasks.
func (s *Service) GetWaypoint(ctx context.Context, waypointID string) (Waypoint, error) {
	return s.repo.GetWaypoint(ctx, waypointID)
}

// UpdateWaypoint applies the non-nil fields of in and re-validates the result.
func (s *Service) UpdateWaypoint(ctx context.Context, waypointID string, in UpdateWaypointInput) (Waypoint, error) {
	waypoint, err := s.repo.GetWaypoint(ctx, waypointID)
	if err != nil {
		return Waypoint{}, err
	}

	if in.Label != nil {
		waypoint.Label = strings.TrimSpace(*in.Label)
	}
	if in.Lat != nil {
		waypoint.Lat = *in.Lat
	}
	if in.Lng != nil {
		waypoint.Lng = *in.Lng
	}
	if in.BoundaryRadiusM != nil {
		waypoint.BoundaryRadiusM = *in.BoundaryRadiusM
	}

	if err := validateWaypoint(waypoint.Label, waypoint.Lat, waypoint.Lng, waypoint.BoundaryRadiusM); err != nil {
		return Waypoint{}, err
	}
	if err := s.repo.UpdateWaypoint(ctx, waypoint); err != nil {
		return Waypoint{}, fmt.Errorf("update waypoint %s: %w", waypointID, err)
	}

	return waypoint, nil
}

// DeleteWaypoint removes a leg from its route and returns what is left.
//
// The remaining waypoints are renumbered so the sequence stays 0..n-1: the
// in-car runtime walks display_order to decide what is next, so a hole left
// where the deleted leg was would strand a crew at the gap. The renumbered
// route comes back for the same reason ReorderWaypoints returns one — every
// sibling's position may have moved, so the editor re-renders from the server.
func (s *Service) DeleteWaypoint(ctx context.Context, waypointID string) (Route, error) {
	waypoint, err := s.repo.GetWaypoint(ctx, waypointID)
	if err != nil {
		return Route{}, err
	}

	if err := s.repo.DeleteWaypoint(ctx, waypoint.RouteID, waypointID); err != nil {
		return Route{}, fmt.Errorf("delete waypoint %s: %w", waypointID, err)
	}

	return s.GetRoute(ctx, waypoint.RouteID)
}

// ReorderWaypoints rewrites the leg sequence of a route.
//
// orderedIDs must be a permutation of exactly the route's current waypoints. A
// partial list would silently drop legs from the course, so it is rejected
// rather than applied.
func (s *Service) ReorderWaypoints(ctx context.Context, routeID string, orderedIDs []string) error {
	current, err := s.repo.ListWaypoints(ctx, routeID)
	if err != nil {
		return fmt.Errorf("list waypoints of route %s: %w", routeID, err)
	}

	if err := validatePermutation(current, orderedIDs); err != nil {
		return err
	}
	if err := s.repo.ReorderWaypoints(ctx, routeID, orderedIDs); err != nil {
		return fmt.Errorf("reorder waypoints of route %s: %w", routeID, err)
	}

	return nil
}

// AttachTasks replaces the tasks bound to a waypoint. Passing an empty list
// detaches everything, which is how an organizer clears a waypoint.
func (s *Service) AttachTasks(ctx context.Context, waypointID string, taskIDs []string) error {
	if _, err := s.repo.GetWaypoint(ctx, waypointID); err != nil {
		return err
	}

	deduped := make([]string, 0, len(taskIDs))
	for _, id := range taskIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			return apperr.Validationf("task ids must not be empty")
		}
		if !slices.Contains(deduped, id) {
			deduped = append(deduped, id)
		}
	}

	if err := s.repo.AttachTasks(ctx, waypointID, deduped); err != nil {
		return fmt.Errorf("attach tasks to waypoint %s: %w", waypointID, err)
	}

	return nil
}

func validateWaypoint(label string, lat, lng float64, radiusM int) error {
	if label == "" {
		return apperr.Validationf("waypoint label is required")
	}
	if lat < -90 || lat > 90 {
		return apperr.Validationf("waypoint latitude must be between -90 and 90")
	}
	if lng < -180 || lng > 180 {
		return apperr.Validationf("waypoint longitude must be between -180 and 180")
	}
	// A zero radius could never be entered given GPS error, so it is a mistake.
	if radiusM <= 0 {
		return apperr.Validationf("waypoint boundary radius must be greater than zero")
	}

	return nil
}

func validatePermutation(current []Waypoint, orderedIDs []string) error {
	if len(orderedIDs) != len(current) {
		return apperr.Validationf("the new order must list all %d waypoints of this route, got %d",
			len(current), len(orderedIDs))
	}

	remaining := make(map[string]struct{}, len(current))
	for _, w := range current {
		remaining[w.ID] = struct{}{}
	}
	for _, id := range orderedIDs {
		if _, ok := remaining[id]; !ok {
			return apperr.Validationf("waypoint %s is not part of this route, or was listed twice", id)
		}
		delete(remaining, id)
	}

	return nil
}
