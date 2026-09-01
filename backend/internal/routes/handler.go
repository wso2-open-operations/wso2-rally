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
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
)

// Handler exposes the routes and waypoints REST surface.
type Handler struct {
	service *Service
	logger  *slog.Logger
}

// NewHandler wires a Handler to its service.
func NewHandler(service *Service, logger *slog.Logger) *Handler {
	return &Handler{service: service, logger: logger}
}

// Register adds the route and waypoint endpoints to r.
func (h *Handler) Register(r chi.Router) {
	r.Post("/events/{eventId}/routes", h.createRoute)
	r.Get("/events/{eventId}/routes", h.listRoutes)
	r.Get("/routes/{routeId}", h.getRoute)
	r.Patch("/routes/{routeId}", h.updateRoute)
	r.Post("/routes/{routeId}/waypoints", h.addWaypoint)
	r.Patch("/routes/{routeId}/waypoints/order", h.reorderWaypoints)
	r.Patch("/waypoints/{waypointId}", h.updateWaypoint)
	r.Delete("/waypoints/{waypointId}", h.deleteWaypoint)
	r.Post("/waypoints/{waypointId}/tasks", h.attachTasks)
}

func (h *Handler) createRoute(w http.ResponseWriter, r *http.Request) {
	var req CreateRouteRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	route, err := h.service.CreateRoute(r.Context(), CreateRouteInput{
		EventID: chi.URLParam(r, "eventId"),
		Name:    req.Name,
		Order:   req.Order,
	})
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteCreated(w, "/routes/"+route.ID, toRouteDTO(route))
}

func (h *Handler) listRoutes(w http.ResponseWriter, r *http.Request) {
	found, err := h.service.ListRoutes(r.Context(), chi.URLParam(r, "eventId"))
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toRouteDTOs(found))
}

func (h *Handler) getRoute(w http.ResponseWriter, r *http.Request) {
	route, err := h.service.GetRoute(r.Context(), chi.URLParam(r, "routeId"))
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toRouteDTO(route))
}

func (h *Handler) updateRoute(w http.ResponseWriter, r *http.Request) {
	var req UpdateRouteRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	route, err := h.service.UpdateRoute(r.Context(), chi.URLParam(r, "routeId"), UpdateRouteInput{
		Name:  req.Name,
		Order: req.Order,
	})
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toRouteDTO(route))
}

func (h *Handler) addWaypoint(w http.ResponseWriter, r *http.Request) {
	var req AddWaypointRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	waypoint, err := h.service.AddWaypoint(r.Context(), AddWaypointInput{
		RouteID:         chi.URLParam(r, "routeId"),
		Label:           req.Label,
		Lat:             req.Lat,
		Lng:             req.Lng,
		BoundaryRadiusM: req.BoundaryRadiusM,
	})
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteCreated(w, "/waypoints/"+waypoint.ID, toWaypointDTO(waypoint))
}

func (h *Handler) updateWaypoint(w http.ResponseWriter, r *http.Request) {
	var req UpdateWaypointRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	waypoint, err := h.service.UpdateWaypoint(r.Context(), chi.URLParam(r, "waypointId"), UpdateWaypointInput{
		Label:           req.Label,
		Lat:             req.Lat,
		Lng:             req.Lng,
		BoundaryRadiusM: req.BoundaryRadiusM,
	})
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toWaypointDTO(waypoint))
}

func (h *Handler) deleteWaypoint(w http.ResponseWriter, r *http.Request) {
	route, err := h.service.DeleteWaypoint(r.Context(), chi.URLParam(r, "waypointId"))
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	// The renumbered route, not 204: deleting a leg shifts every waypoint after
	// it, so the editor needs the new sequence rather than its own guess at it.
	httpx.WriteJSON(w, http.StatusOK, toRouteDTO(route))
}

func (h *Handler) reorderWaypoints(w http.ResponseWriter, r *http.Request) {
	var req ReorderWaypointsRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	routeID := chi.URLParam(r, "routeId")
	if err := h.service.ReorderWaypoints(r.Context(), routeID, req.OrderedIDs); err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	// Return the reordered route so the organizer UI can re-render from the
	// server's view rather than trusting its optimistic drag-and-drop state.
	route, err := h.service.GetRoute(r.Context(), routeID)
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toRouteDTO(route))
}

func (h *Handler) attachTasks(w http.ResponseWriter, r *http.Request) {
	var req AttachTasksRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	waypointID := chi.URLParam(r, "waypointId")
	if err := h.service.AttachTasks(r.Context(), waypointID, req.TaskIDs); err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	waypoint, err := h.service.GetWaypoint(r.Context(), waypointID)
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toWaypointDTO(waypoint))
}
