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
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/alerts"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/config"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/middleware"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/realtime"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/scoring"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/sessions"
)

// Topic prefixes clients may subscribe to over /ws.
const (
	eventTopicPrefix   = "event:"
	sessionTopicPrefix = "session:"
)

// scoreDeltaType is the message that makes the leaderboard stale.
const scoreDeltaType = "score_delta"

// leaderboardRefreshTimeout bounds the query behind a leaderboard refresh.
// The refresh runs on the crew's submit request, so an unbounded one would
// hold up the car rather than just the pavilion screen.
const leaderboardRefreshTimeout = 5 * time.Second

// wsHandler upgrades /ws?topic=... after checking the caller is allowed to
// listen to that topic.
//
// Organizers may watch any event; a crew may watch only its own session. Both
// checks matter: the session topic carries the cipher reveal, and the event
// topic carries every other team's position.
func wsHandler(cfg config.Config, hub *realtime.Hub, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := authz.IdentityFrom(r.Context())
		if !ok {
			httpx.WriteUnauthorized(w)
			return
		}

		topic := r.URL.Query().Get("topic")
		if !maySubscribe(identity, topic, cfg) {
			logger.Warn("rejected a websocket subscription",
				"topic", topic,
				"kind", identity.Kind,
				"request_id", httpx.RequestIDFrom(r.Context()),
			)
			httpx.WriteError(w, http.StatusForbidden, httpx.MsgForbidden)
			return
		}

		hub.ServeWS(w, r, topic)
	}
}

// maySubscribe decides who may listen to topic.
//
// An Asgardeo token resolves to organizer *kind* for anyone who holds one —
// including a crew member, since the micro app is embedded in the super app.
// /ws sits under Auth, not RequireOrganizer (it also serves crews), so kind
// alone would let that crew member watch every event's monitor and every
// other car's session. The group check below is what RequireOrganizer does
// for REST; this is its WebSocket equivalent.
func maySubscribe(identity authz.Identity, topic string, cfg config.Config) bool {
	switch {
	case identity.IsOrganizer():
		if !middleware.HasAnyRole(identity.Groups, cfg.OrganizerRole, cfg.AdminRole) {
			return false
		}

		// Staff run the rally; both views are theirs to watch.
		return strings.HasPrefix(topic, eventTopicPrefix) || strings.HasPrefix(topic, sessionTopicPrefix)
	case identity.IsTeam():
		return topic == sessions.SessionTopic(identity.SessionID)
	default:
		return false
	}
}

// newSessionBroadcaster returns the publisher the in-car runtime uses.
//
// It also refreshes the leaderboard whenever a score changes: the leaderboard
// is derived from every team's total, so no single domain can produce it, and
// composing it here keeps sessions from depending on scoring.
func newSessionBroadcaster(hub *realtime.Hub, scores *scoring.Service, logger *slog.Logger) sessions.Broadcaster {
	return func(topic string, message any) {
		hub.Broadcast(topic, message)

		eventID, ok := strings.CutPrefix(topic, eventTopicPrefix)
		if !ok || !isScoreDelta(message) {
			return
		}

		// Deliberately not the request context: the pavilion screen still
		// needs the new standings even if the crew's phone has hung up.
		ctx, cancel := context.WithTimeout(context.Background(), leaderboardRefreshTimeout)
		defer cancel()

		entries, err := scores.Leaderboard(ctx, eventID)
		if err != nil {
			logger.Error("failed to refresh the leaderboard after a score change",
				"error", err, "event_id", eventID)
			return
		}
		hub.Broadcast(topic, map[string]any{"type": "leaderboard", "entries": entries})
	}
}

func isScoreDelta(message any) bool {
	fields, ok := message.(map[string]any)
	if !ok {
		return false
	}
	messageType, _ := fields["type"].(string)

	return messageType == scoreDeltaType
}

// newAlertBroadcaster publishes raised and resolved alerts to the organizer's
// live monitor in the wire shape the web app already reads.
func newAlertBroadcaster(hub *realtime.Hub) alerts.Broadcaster {
	return func(eventID string, message any) {
		payload := message
		if alert, ok := message.(alerts.Alert); ok {
			payload = map[string]any{"type": "alert", "alert": alerts.ToDTO(alert)}
		}
		hub.Broadcast(sessions.EventTopic(eventID), payload)
	}
}

// originHostOf reduces a configured CORS origin to the host[:port] pattern the
// WebSocket library matches on. An unparseable or empty value yields "", which
// leaves the socket same-origin only.
func originHostOf(allowOrigin string) string {
	if allowOrigin == "" {
		return ""
	}

	parsed, err := url.Parse(allowOrigin)
	if err != nil || parsed.Host == "" {
		return ""
	}

	return parsed.Host
}
