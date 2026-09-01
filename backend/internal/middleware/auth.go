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

package middleware

import (
	"net/http"
	"slices"
	"strings"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/config"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
)

const bearerPrefix = "Bearer "

// OrganizerValidator resolves an Asgardeo id token. It is an interface so the
// router can inject either the JWKS-backed validator or the decode-only one
// without this package knowing which.
type OrganizerValidator interface {
	Validate(rawToken string) (authz.Identity, error)
}

// Auth authenticates every request carrying a bearer token and stores the
// resulting identity on the context.
//
// Team tokens are tried first because they are cheap to verify locally and
// carry our own issuer; anything else is handed to the organizer validator.
// A token that satisfies neither is a 401 — the response never says which
// check failed.
func Auth(cfg config.Config, organizer OrganizerValidator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := bearerToken(r)
			if !ok {
				httpx.WriteUnauthorized(w)
				return
			}

			identity, err := authz.VerifyTeamToken(cfg.TeamTokenSecret, raw)
			if err != nil {
				identity, err = organizer.Validate(raw)
			}
			if err != nil {
				httpx.WriteUnauthorized(w)
				return
			}

			next.ServeHTTP(w, r.WithContext(authz.WithIdentity(r.Context(), identity)))
		})
	}
}

// RequireOrganizer rejects anyone who is not staff. Mount it on every organizer
// route group, under Auth.
//
// It checks the group as well as the token kind. Since the in-car app is
// embedded in the super app, a crew member arrives holding a perfectly valid
// Asgardeo token, which Auth resolves to an organizer-kind identity — so kind
// alone would admit every participant to the fleet roster and the live monitor.
// Admin *actions* were always group-gated; this closes the read surface.
func RequireOrganizer(cfg config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := authz.IdentityFrom(r.Context())
			if !ok {
				httpx.WriteUnauthorized(w)
				return
			}
			// Either group admits: an admin is an organizer without having to
			// be listed in both. Note this is *any*, not authz.CheckRoles,
			// which requires every role it is given.
			if !identity.IsOrganizer() ||
				!hasAnyRole(identity.Groups, cfg.OrganizerRole, cfg.AdminRole) {
				httpx.WriteError(w, http.StatusForbidden, httpx.MsgForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequireTeam rejects anyone who is not an in-car phone.
func RequireTeam(next http.Handler) http.Handler {
	return requireKind(authz.KindTeam, next)
}

// RequireAdmin gates the organizer actions that change an event's shape, such
// as publishing it or importing vehicles.
func RequireAdmin(cfg config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := authz.IdentityFrom(r.Context())
			if !ok {
				httpx.WriteUnauthorized(w)
				return
			}
			if !identity.IsOrganizer() || !authz.CheckRoles([]string{cfg.AdminRole}, identity.Groups) {
				httpx.WriteError(w, http.StatusForbidden, httpx.MsgForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// hasAnyRole reports whether have contains at least one of the named roles.
//
// Empty role names are skipped rather than matched: an unset ORGANIZER_ROLE must
// not turn into a group everybody is in. If every candidate is empty this
// returns false, so a misconfigured deployment locks the surface rather than
// opening it.
func hasAnyRole(have []string, anyOf ...string) bool {
	for _, role := range anyOf {
		if role != "" && slices.Contains(have, role) {
			return true
		}
	}

	return false
}

func requireKind(kind authz.Kind, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, ok := authz.IdentityFrom(r.Context())
		if !ok {
			httpx.WriteUnauthorized(w)
			return
		}
		if identity.Kind != kind {
			httpx.WriteError(w, http.StatusForbidden, httpx.MsgForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// bearerToken extracts the credential from an Authorization header, falling
// back to the WebSocket subprotocol list for handshakes, which cannot carry one.
//
// The header is authoritative where both are present: an ordinary request has
// no business offering subprotocols, and preferring them would let one override
// the credential the caller actually authenticated with.
func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	if len(header) < len(bearerPrefix) || !strings.EqualFold(header[:len(bearerPrefix)], bearerPrefix) {
		return subprotocolToken(r)
	}

	token := strings.TrimSpace(header[len(bearerPrefix):])
	if token == "" {
		return subprotocolToken(r)
	}

	return token, true
}

// isWebSocketHandshake reports whether this request is an Upgrade to WebSocket.
//
// RFC 6455 requires the token `websocket` in Upgrade, and the header may list
// several tokens, so match an entry rather than the whole value.
func isWebSocketHandshake(r *http.Request) bool {
	for _, value := range r.Header.Values("Upgrade") {
		for entry := range strings.SplitSeq(value, ",") {
			if strings.EqualFold(strings.TrimSpace(entry), "websocket") {
				return true
			}
		}
	}

	return false
}

// subprotocolToken reads the token a browser offered as
// `Sec-WebSocket-Protocol: rally-bearer, <token>`.
//
// Only a handshake is consulted. The fallback exists because a browser cannot
// set a header on one; an ordinary request can, so honouring a subprotocol
// there would open a second credential channel across the whole API to serve
// the single route that needs it.
//
// Only the entry immediately after the marker counts. Anything else — the
// marker alone, some other protocol, a name that merely starts the same way —
// yields nothing, so a malformed handshake is a 401 rather than a guess.
func subprotocolToken(r *http.Request) (string, bool) {
	if !isWebSocketHandshake(r) {
		return "", false
	}

	offered := r.Header.Values("Sec-WebSocket-Protocol")
	if len(offered) == 0 {
		return "", false
	}

	// The header may arrive as one comma-separated list or as repeated headers.
	var protocols []string
	for _, value := range offered {
		for entry := range strings.SplitSeq(value, ",") {
			protocols = append(protocols, strings.TrimSpace(entry))
		}
	}

	for i, protocol := range protocols {
		if protocol != authz.BearerSubprotocol {
			continue
		}
		if i+1 < len(protocols) && protocols[i+1] != "" {
			return protocols[i+1], true
		}

		return "", false
	}

	return "", false
}
