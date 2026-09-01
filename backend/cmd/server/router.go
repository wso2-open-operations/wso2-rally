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

package main

import (
	"database/sql"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/alerts"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/config"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/debrief"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/events"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/middleware"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/realtime"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/routes"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/scoring"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/sessions"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/tasks"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/vehicles"
)

// deps is everything the routing tree needs. Building it in one place keeps
// wiring visible and makes the router testable end to end.
type deps struct {
	cfg       config.Config
	db        *sql.DB
	logger    *slog.Logger
	organizer middleware.OrganizerValidator
}

// newRouter assembles the middleware stack and mounts every domain.
//
// The layering is deliberate: correlation id first so every later log line can
// reference it, recovery outside the handlers, then authentication, and only
// then the role gates each route group needs.
func newRouter(d deps) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.SecurityHeaders)
	r.Use(middleware.Logger(d.logger))
	r.Use(middleware.Recover(d.logger))
	r.Use(middleware.CORS(d.cfg.CORSAllowOrigin))

	// Unauthenticated: Choreo's health probe.
	r.Get("/health", health)

	// Shared between both identities: the micro app reads task definitions to
	// render a task body, using the same endpoint the organizer edits through.
	tasksHandler := tasks.NewHandler(tasks.NewService(tasks.NewRepo(d.db)), d.logger)

	// Shared by the alerts domain, which flips a vehicle's status when a
	// breakdown is raised.
	vehiclesService := vehicles.NewService(vehicles.NewRepo(d.db))

	// The hub is the fan-out behind every live view. Services publish to it
	// through the broadcasters wired below.
	hub := realtime.NewHub(d.logger, originHostOf(d.cfg.CORSAllowOrigin))
	scoringService := scoring.NewService(scoring.NewRepo(d.db))

	// Alerts move a vehicle's status and push to the organizer's live monitor.
	alertsService := alerts.NewService(alerts.NewRepo(d.db), vehiclesService, newAlertBroadcaster(hub))

	// The in-car runtime mints its own team tokens at bind time and files crew
	// reports through the same alerts service organizers use.
	sessionsService := sessions.NewService(
		sessions.NewRepo(d.db),
		sessions.HMACTokenMinter{Secret: d.cfg.TeamTokenSecret, TTL: d.cfg.TeamTokenTTL},
		alertsService,
		newSessionBroadcaster(hub, scoringService, d.logger),
	)
	sessionsHandler := sessions.NewHandler(sessionsService, d.logger)

	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(d.cfg, d.organizer))

		// Live updates. The handler checks the caller may listen to the topic
		// it asked for before upgrading.
		r.Get("/ws", wsHandler(hub, d.logger))

		// Joining is what turns the super app's identity into a team token, so
		// it sits under Auth but above every role gate: the caller is a crew
		// member with no organizer group, and the roster decides, not a role.
		sessionsHandler.RegisterJoin(r)

		// Readable by either identity. Mounted above the role gates because
		// chi cannot carry the same path in two sibling groups; the handler
		// strips the answers when the caller is a crew.
		tasksHandler.RegisterShared(r)

		// In-car surface.
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireTeam)

			sessionsHandler.RegisterTeam(r)
		})

		// Organizer surface.
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireOrganizer(d.cfg))

			r.Get("/users/me", currentUser)
			events.NewHandler(events.NewService(events.NewRepo(d.db)), d.logger).Register(r)
			routes.NewHandler(routes.NewService(routes.NewRepo(d.db)), d.logger).Register(r)
			tasksHandler.Register(r)
			vehicles.NewHandler(vehiclesService, d.logger).Register(r)
			alerts.NewHandler(alertsService, d.logger).Register(r)
			scoring.NewHandler(scoringService, d.logger).Register(r)
			debrief.NewHandler(debrief.NewService(debrief.NewRepo(d.db)), d.logger).Register(r)
		})
	})

	return r
}

func health(w http.ResponseWriter, _ *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// currentUser echoes the identity resolved from the bearer token, which the
// web app uses to render the signed-in organizer and gate admin-only UI.
func currentUser(w http.ResponseWriter, r *http.Request) {
	identity, ok := authz.IdentityFrom(r.Context())
	if !ok {
		httpx.WriteUnauthorized(w)
		return
	}

	groups := identity.Groups
	if groups == nil {
		groups = []string{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"userId": identity.UserID,
		"email":  identity.Email,
		"groups": groups,
	})
}
