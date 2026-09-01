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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/config"
)

const teamSecret = "s"

// stubValidator stands in for the Asgardeo-backed organizer validator.
type stubValidator struct {
	identity authz.Identity
	err      error
}

func (s stubValidator) Validate(string) (authz.Identity, error) { return s.identity, s.err }

func rejectingValidator() stubValidator {
	return stubValidator{err: authz.ErrInvalidToken}
}

func TestAuth_NoTokenIs401(t *testing.T) {
	rr := serve(t, Auth(testConfig(), rejectingValidator()), nil, "")

	require.Equal(t, http.StatusUnauthorized, rr.Code)
	require.Equal(t, "Authentication required.", messageOf(t, rr))
}

func TestAuth_MalformedHeaderIs401(t *testing.T) {
	for _, header := range []string{"Bearer", "Basic abc", "Bearer ", "token-without-scheme"} {
		t.Run(header, func(t *testing.T) {
			rr := serve(t, Auth(testConfig(), rejectingValidator()), nil, header)

			require.Equal(t, http.StatusUnauthorized, rr.Code)
		})
	}
}

func TestAuth_TeamTokenPopulatesIdentity(t *testing.T) {
	tok, err := authz.MintTeamToken(teamSecret, authz.TeamClaims{SessionID: "sess1", VehicleID: "veh1", DeviceID: "dev1", CrewMemberID: "crew1"}, time.Hour)
	require.NoError(t, err)
	var got authz.Identity

	rr := serve(t, Auth(testConfig(), rejectingValidator()), &got, "Bearer "+tok)

	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, authz.KindTeam, got.Kind)
	require.Equal(t, "sess1", got.SessionID)
	require.Equal(t, "veh1", got.VehicleID)
}

func TestAuth_FallsBackToOrganizerValidator(t *testing.T) {
	organizer := authz.Identity{Kind: authz.KindOrganizer, UserID: "u1", Groups: []string{"rally-admin"}}
	var got authz.Identity

	rr := serve(t, Auth(testConfig(), stubValidator{identity: organizer}), &got, "Bearer whatever")

	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, organizer, got)
}

// A team token signed with the wrong secret must not fall through to the
// organizer validator and be accepted as staff.
func TestAuth_RejectsTeamTokenWithWrongSecret(t *testing.T) {
	tok, err := authz.MintTeamToken("a-different-secret", authz.TeamClaims{SessionID: "sess1", VehicleID: "veh1", DeviceID: "dev1", CrewMemberID: "crew1"}, time.Hour)
	require.NoError(t, err)

	rr := serve(t, Auth(testConfig(), rejectingValidator()), nil, "Bearer "+tok)

	require.Equal(t, http.StatusUnauthorized, rr.Code)
}

// Since the micro app is embedded in the super app, every crew member holds a
// valid Asgardeo token too — which this middleware sees as an organizer-kind
// identity. Token kind therefore no longer separates staff from participants,
// and without a group check a crew member could read the whole organizer
// surface: the fleet with everyone's phone numbers, the live monitor, the lot.
func TestRequireOrganizer(t *testing.T) {
	tests := []struct {
		name     string
		identity authz.Identity
		want     int
	}{
		{
			"organizer in the group passes",
			authz.Identity{Kind: authz.KindOrganizer, UserID: "u", Groups: []string{"rally-organizer"}},
			http.StatusOK,
		},
		{
			"an admin is also an organizer",
			authz.Identity{Kind: authz.KindOrganizer, UserID: "u", Groups: []string{"rally-admin"}},
			http.StatusOK,
		},
		{
			"a signed-in crew member is not staff",
			authz.Identity{Kind: authz.KindOrganizer, UserID: "u", Groups: []string{"rally-crew"}},
			http.StatusForbidden,
		},
		{
			"no groups at all",
			authz.Identity{Kind: authz.KindOrganizer, UserID: "u"},
			http.StatusForbidden,
		},
		{
			"team token is forbidden however it is grouped",
			authz.Identity{Kind: authz.KindTeam, SessionID: "s", Groups: []string{"rally-organizer"}},
			http.StatusForbidden,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rr := serveWithIdentity(t, RequireOrganizer(testConfig()), tt.identity)

			require.Equal(t, tt.want, rr.Code)
		})
	}
}

func TestRequireTeam(t *testing.T) {
	rr := serveWithIdentity(t, RequireTeam, authz.Identity{Kind: authz.KindOrganizer, UserID: "u"})

	require.Equal(t, http.StatusForbidden, rr.Code)
}

func TestRequireAdmin(t *testing.T) {
	tests := []struct {
		name     string
		identity authz.Identity
		want     int
	}{
		{"admin group passes", authz.Identity{Kind: authz.KindOrganizer, Groups: []string{"rally-admin"}}, http.StatusOK},
		{"organizer without the group", authz.Identity{Kind: authz.KindOrganizer, Groups: []string{"other"}}, http.StatusForbidden},
		{"team never passes", authz.Identity{Kind: authz.KindTeam, Groups: []string{"rally-admin"}}, http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rr := serveWithIdentity(t, RequireAdmin(testConfig()), tt.identity)

			require.Equal(t, tt.want, rr.Code)
		})
	}
}

func TestRequire_WithoutIdentityIs401(t *testing.T) {
	rr := httptest.NewRecorder()

	RequireOrganizer(testConfig())(okHandler(nil)).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/x", nil))

	require.Equal(t, http.StatusUnauthorized, rr.Code)
}

func testConfig() config.Config {
	return config.Config{
		TeamTokenSecret: teamSecret,
		AdminRole:       "rally-admin",
		OrganizerRole:   "rally-organizer",
	}
}

// serve runs one request through mw, recording the identity the handler sees.
func serve(t *testing.T, mw func(http.Handler) http.Handler, capture *authz.Identity, authHeader string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rr := httptest.NewRecorder()
	mw(okHandler(capture)).ServeHTTP(rr, req)

	return rr
}

func serveWithIdentity(t *testing.T, mw func(http.Handler) http.Handler, id authz.Identity) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req = req.WithContext(authz.WithIdentity(req.Context(), id))
	rr := httptest.NewRecorder()
	mw(okHandler(nil)).ServeHTTP(rr, req)

	return rr
}

func okHandler(capture *authz.Identity) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if capture != nil {
			*capture, _ = authz.IdentityFrom(r.Context())
		}
		w.WriteHeader(http.StatusOK)
	})
}

func messageOf(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()

	var body struct {
		Message string `json:"message"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &body))

	return body.Message
}

func TestAuth_401CarriesTheBearerChallenge(t *testing.T) {
	rr := serve(t, Auth(testConfig(), rejectingValidator()), nil, "")

	require.Equal(t, http.StatusUnauthorized, rr.Code)
	require.Equal(t, `Bearer realm="rally"`, rr.Header().Get("WWW-Authenticate"))
}

// A 403 is not a challenge: the caller authenticated fine, they just may not
// touch this resource.
func TestRequireOrganizer_403HasNoChallenge(t *testing.T) {
	rr := serveWithIdentity(t, RequireOrganizer(testConfig()), authz.Identity{Kind: authz.KindTeam, SessionID: "s"})

	require.Equal(t, http.StatusForbidden, rr.Code)
	require.Empty(t, rr.Header().Get("WWW-Authenticate"))
}

// A browser cannot set an Authorization header on a WebSocket handshake:
// `new WebSocket(url)` takes no headers. The only channel it controls is the
// subprotocol list, so the token rides there — and it must NOT ride in the
// query string, which the request logger and any proxy would record.
func TestAuth_AcceptsATokenFromTheWebSocketSubprotocol(t *testing.T) {
	tok, err := authz.MintTeamToken(teamSecret,
		authz.TeamClaims{SessionID: "sess1", VehicleID: "veh1", DeviceID: "dev1", CrewMemberID: "crew1"},
		time.Hour)
	require.NoError(t, err)
	var got authz.Identity

	rr := serveWithSubprotocols(t, Auth(testConfig(), rejectingValidator()), &got,
		authz.BearerSubprotocol+", "+tok)

	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, authz.KindTeam, got.Kind)
	require.Equal(t, "sess1", got.SessionID)
}

// The fallback exists for handshakes, which cannot carry an Authorization
// header. An ordinary request has no business offering subprotocols, so
// honouring one there would be a second credential channel across the whole
// API to serve a single route.
func TestAuth_IgnoresSubprotocolOnANonHandshake(t *testing.T) {
	tok, err := authz.MintTeamToken(teamSecret,
		authz.TeamClaims{SessionID: "sess1", VehicleID: "veh1", DeviceID: "dev1", CrewMemberID: "crew1"},
		time.Hour)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Sec-WebSocket-Protocol", authz.BearerSubprotocol+", "+tok)
	// Deliberately no Upgrade header: this is a plain REST call.
	rr := httptest.NewRecorder()
	var got authz.Identity
	Auth(testConfig(), rejectingValidator())(okHandler(&got)).ServeHTTP(rr, req)

	require.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAuth_SubprotocolTokenWorksForOrganizersToo(t *testing.T) {
	organizer := authz.Identity{Kind: authz.KindOrganizer, UserID: "u1", Groups: []string{"rally-admin"}}
	var got authz.Identity

	rr := serveWithSubprotocols(t, Auth(testConfig(), stubValidator{identity: organizer}), &got,
		authz.BearerSubprotocol+",an-id-token")

	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, organizer, got)
}

// The Authorization header stays authoritative: a subprotocol list is only
// consulted when there is no header to read.
func TestAuth_HeaderWinsOverSubprotocol(t *testing.T) {
	tok, err := authz.MintTeamToken(teamSecret,
		authz.TeamClaims{SessionID: "from-header", VehicleID: "v", DeviceID: "d", CrewMemberID: "c"},
		time.Hour)
	require.NoError(t, err)
	var got authz.Identity

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Sec-WebSocket-Protocol", authz.BearerSubprotocol+", not-a-real-token")
	rr := httptest.NewRecorder()
	Auth(testConfig(), rejectingValidator())(okHandler(&got)).ServeHTTP(rr, req)

	require.Equal(t, http.StatusOK, rr.Code)
	require.Equal(t, "from-header", got.SessionID)
}

func TestAuth_RejectsMalformedSubprotocolLists(t *testing.T) {
	for _, offered := range []string{
		"",                             // no subprotocols at all
		"graphql-ws",                   // some other protocol
		authz.BearerSubprotocol,        // the marker with no token after it
		authz.BearerSubprotocol + ", ", // the marker with an empty token
		"rally-bearer-ish, some-token", // a marker that only looks like ours
	} {
		t.Run(offered, func(t *testing.T) {
			rr := serveWithSubprotocols(t, Auth(testConfig(), rejectingValidator()), nil, offered)

			require.Equal(t, http.StatusUnauthorized, rr.Code)
		})
	}
}

func serveWithSubprotocols(
	t *testing.T, mw func(http.Handler) http.Handler, capture *authz.Identity, offered string,
) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	// These cases are handshakes; the fallback is only consulted on one.
	req.Header.Set("Upgrade", "websocket")
	if offered != "" {
		req.Header.Set("Sec-WebSocket-Protocol", offered)
	}
	rr := httptest.NewRecorder()
	mw(okHandler(capture)).ServeHTTP(rr, req)

	return rr
}
