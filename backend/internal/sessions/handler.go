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

package sessions

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/alerts"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
)

// Handler exposes the in-car REST surface.
type Handler struct {
	service *Service
	logger  *slog.Logger
}

// NewHandler wires a Handler to its service.
func NewHandler(service *Service, logger *slog.Logger) *Handler {
	return &Handler{service: service, logger: logger}
}

// RegisterJoin adds the one endpoint that runs before a phone has a *team*
// token but after the super app has authenticated the person holding it.
//
// It is mounted under Auth but outside RequireOrganizer: the caller is a crew
// member, not staff, so they carry no organizer group. The roster decides
// whether they may join, not a role.
func (h *Handler) RegisterJoin(r chi.Router) {
	r.Post("/sessions/join", h.join)
}

// RegisterTeam adds the endpoints a joined phone calls. Every one of them takes
// its session and device from the team token, never from the request, so a phone
// can only ever act as itself.
func (h *Handler) RegisterTeam(r chi.Router) {
	r.Get("/sessions/me", h.state)
	r.Post("/sessions/me/location", h.ping)
	r.Get("/sessions/me/tasks", h.listTasks)
	r.Post("/sessions/me/tasks/{taskId}/submit", h.submitTask)
	r.Post("/sessions/me/alerts", h.raiseAlert)
	r.Post("/sessions/me/finish", h.finish)
	r.Get("/sessions/me/vouchers", h.vouchers)
}

func (h *Handler) join(w http.ResponseWriter, r *http.Request) {
	var req JoinRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	// The identity comes from the verified token, never from the body — a phone
	// that could name its own email could join any car on the roster.
	identity, ok := authz.IdentityFrom(r.Context())
	if !ok || !identity.IsOrganizer() {
		// Not "you are not staff": a team token means this phone has already
		// joined and should be using /sessions/me, and no identity at all means
		// the super app never handed one over.
		httpx.WriteError(w, http.StatusForbidden, httpx.MsgForbidden)
		return
	}

	result, err := h.service.Join(r.Context(), JoinInput{
		VehicleID:   req.VehicleID,
		CallerEmail: identity.Email,
	})
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, toJoinResponse(result, time.Now().UTC()))
}

func (h *Handler) state(w http.ResponseWriter, r *http.Request) {
	caller, ok := callerFrom(w, r)
	if !ok {
		return
	}

	state, err := h.service.State(r.Context(), caller.sessionID, caller.deviceID)
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toStateDTO(state, time.Now().UTC()))
}

func (h *Handler) ping(w http.ResponseWriter, r *http.Request) {
	caller, ok := callerFrom(w, r)
	if !ok {
		return
	}

	var req LocationRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	// Accuracy is accepted so the client need not special-case it, but nothing
	// is decided from it yet: a geofence call is made from the reported point.
	result, err := h.service.Ping(r.Context(), caller.sessionID, caller.deviceID,
		LatLng{Lat: req.Lat, Lng: req.Lng})
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toPingResponse(result))
}

func (h *Handler) listTasks(w http.ResponseWriter, r *http.Request) {
	caller, ok := callerFrom(w, r)
	if !ok {
		return
	}

	states, err := h.service.ListTasks(r.Context(), caller.sessionID)
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toTaskStateDTOs(states))
}

// submitTask scores one attempt. The payload shape is per task type, so it is
// passed through to the engine untouched.
func (h *Handler) submitTask(w http.ResponseWriter, r *http.Request) {
	caller, ok := callerFrom(w, r)
	if !ok {
		return
	}

	var payload json.RawMessage
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	result, err := h.service.SubmitTask(r.Context(), caller.sessionID, caller.crewMemberID,
		chi.URLParam(r, "taskId"), payload)
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, SubmitResultDTO{
		Correct:       result.Correct,
		AwardedPoints: result.AwardedPoints,
		Detail:        result.Detail,
	})
}

func (h *Handler) raiseAlert(w http.ResponseWriter, r *http.Request) {
	caller, ok := callerFrom(w, r)
	if !ok {
		return
	}

	var req CrewAlertRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	raised, err := h.service.RaiseCrewAlert(r.Context(), caller.sessionID, CrewAlertInput{
		Type: req.Type,
		Note: req.Note,
		Lat:  req.Lat,
		Lng:  req.Lng,
	})
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, alerts.ToDTO(raised))
}

func (h *Handler) finish(w http.ResponseWriter, r *http.Request) {
	caller, ok := callerFrom(w, r)
	if !ok {
		return
	}

	session, err := h.service.Finish(r.Context(), caller.sessionID)
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toSessionDTO(session))
}

func (h *Handler) vouchers(w http.ResponseWriter, r *http.Request) {
	caller, ok := callerFrom(w, r)
	if !ok {
		return
	}

	voucher, err := h.service.Vouchers(r.Context(), caller.sessionID)
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toVoucherDTO(voucher))
}

// caller is which phone is on the line.
//
// The session says which car; the device and member say which of its phones, and
// that distinction is what lets the backend record who answered a task and tell
// a crew who is still sharing location.
type caller struct {
	sessionID    string
	deviceID     string
	crewMemberID string
}

// callerFrom reads the calling phone out of its team token. It writes the 401
// itself and reports false, so handlers can return immediately.
//
// A token missing the device is rejected rather than tolerated: it was minted
// before phones were distinguishable, and guessing which phone it meant would be
// worse than making it join again.
func callerFrom(w http.ResponseWriter, r *http.Request) (caller, bool) {
	identity, ok := authz.IdentityFrom(r.Context())
	if !ok || !identity.IsTeam() || identity.SessionID == "" || identity.DeviceID == "" {
		httpx.WriteUnauthorized(w)
		return caller{}, false
	}

	return caller{
		sessionID:    identity.SessionID,
		deviceID:     identity.DeviceID,
		crewMemberID: identity.CrewMemberID,
	}, true
}
