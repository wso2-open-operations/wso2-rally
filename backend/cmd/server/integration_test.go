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

//go:build integration

// This integration test walks the whole rally against a real MySQL:
// an organizer sets an event up, a crew joins their phones, drives into a
// geofence, answers a task, and appears on the leaderboard.
//
// Run it with a database:
//
//	make docker-db && make test-integration
package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/config"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/storetest"
)

const (
	teamTokenSecret = "integration-secret"
	adminRole       = "rally-admin"
)

// rally drives the API the way the two front ends do.
type rally struct {
	t         *testing.T
	handler   http.Handler
	db        *sql.DB
	organizer string
	teamToken string
}

func newRally(t *testing.T) *rally {
	t.Helper()

	db := storetest.DB(t)
	cfg := config.Config{
		TeamTokenSecret: teamTokenSecret,
		TeamTokenTTL:    time.Hour,
		AdminRole:       adminRole,
		LogLevel:        "ERROR",
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	// TokenValidatorEnabled is false here, so organizer tokens are decoded
	// rather than verified — the same path local development uses.
	handler := newRouter(deps{
		cfg:       cfg,
		db:        db,
		logger:    logger,
		organizer: authz.NewDecodeOnlyValidator(),
	})

	return &rally{t: t, handler: handler, db: db, organizer: organizerToken(t)}
}

// drove rewinds the crew's last position fix into the past, standing in for
// time this test cannot actually spend.
//
// The backend refuses a fix that could only be reached by teleporting — more
// than 60 m/s since the previous one — so two requests sent back to back
// several kilometres apart are, correctly, not a drive. Every hop between legs
// has to say how long it took.
func (r *rally) drove(d time.Duration) {
	r.t.Helper()

	_, err := r.db.Exec(
		"UPDATE team_session SET last_ping_at = ? WHERE last_ping_at IS NOT NULL",
		time.Now().UTC().Add(-d))
	require.NoError(r.t, err)
}

// organizerToken stands in for an Asgardeo id token.
func organizerToken(t *testing.T) string {
	t.Helper()

	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss":    "https://api.asgardeo.io/t/wso2",
		"sub":    "organizer-1",
		"email":  "organizer@wso2.com",
		"groups": []string{adminRole},
		"exp":    time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte("not-verified-in-decode-only-mode"))
	require.NoError(t, err)

	return token
}

// asOrganizer sends a request with the organizer's bearer token.
func (r *rally) asOrganizer(method, path, body string) *httptest.ResponseRecorder {
	return r.do(method, path, body, r.organizer)
}

// asCrew sends a request with the team token issued at bind time.
func (r *rally) asCrew(method, path, body string) *httptest.ResponseRecorder {
	return r.do(method, path, body, r.teamToken)
}

func (r *rally) do(method, path, body, token string) *httptest.ResponseRecorder {
	r.t.Helper()

	var reader io.Reader
	if body != "" {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	r.handler.ServeHTTP(rec, req)

	return rec
}

// decode reads a JSON response, failing the test with the body on a status
// mismatch so a broken step is diagnosable from the output alone.
func decode[T any](t *testing.T, rec *httptest.ResponseRecorder, wantStatus int) T {
	t.Helper()

	require.Equal(t, wantStatus, rec.Code, "unexpected status; body: %s", rec.Body.String())
	var out T
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), "body: %s", rec.Body.String())

	return out
}

type idResponse struct {
	ID string `json:"id"`
}

func TestHealth(t *testing.T) {
	rally := newRally(t)

	rec := rally.do(http.MethodGet, "/health", "", "")

	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `{"status":"ok"}`, rec.Body.String())
}

func TestUnauthenticatedRequestsAreRejected(t *testing.T) {
	rally := newRally(t)

	rec := rally.do(http.MethodPost, "/events/search", `{}`, "")

	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

// TestHappyPath is the whole rally end to end.
func TestHappyPath(t *testing.T) {
	r := newRally(t)

	// --- The organizer sets the rally up. ---

	event := decode[idResponse](t, r.asOrganizer(http.MethodPost, "/events", `{
		"name": "WSO2 Motor Rally 2027",
		"eventDate": "2027-02-13",
		"startTime": "09:00",
		"start": {"label":"Start line","lat":6.8901,"lng":79.92,"radiusM":40},
		"end": {"label":"Pearl Bay","lat":6.848,"lng":79.928,"radiusM":30},
		"cipher": "API Integration"
	}`), http.StatusCreated)
	require.Len(t, event.ID, 32)

	published := decode[struct {
		Status string `json:"status"`
	}](t, r.asOrganizer(http.MethodPost, "/events/"+event.ID+"/publish", ""), http.StatusOK)
	require.Equal(t, "active", published.Status)

	route := decode[idResponse](t,
		r.asOrganizer(http.MethodPost, "/events/"+event.ID+"/routes", `{"name":"Inland"}`),
		http.StatusCreated)

	waypoint := decode[idResponse](t,
		r.asOrganizer(http.MethodPost, "/routes/"+route.ID+"/waypoints",
			`{"label":"Kandy Junction","lat":6.8901,"lng":79.92,"boundaryRadiusM":60}`),
		http.StatusCreated)

	task := decode[idResponse](t,
		r.asOrganizer(http.MethodPost, "/events/"+event.ID+"/tasks", `{
			"code": "T1",
			"title": "Translation Cipher",
			"type": "INPUT_SELECT",
			"trigger": "geofence",
			"points": 50,
			"sensor": "none",
			"config": {"prompt":"Translate the sign","answer":"API Integration"}
		}`), http.StatusCreated)

	attached := decode[struct {
		TaskIDs []string `json:"taskIds"`
	}](t, r.asOrganizer(http.MethodPost, "/waypoints/"+waypoint.ID+"/tasks",
		`{"taskIds":["`+task.ID+`"]}`), http.StatusOK)
	require.Equal(t, []string{task.ID}, attached.TaskIDs)

	vehicle := decode[struct {
		ID   string `json:"id"`
		Crew []struct {
			ID string `json:"id"`
		} `json:"crew"`
	}](t, r.asOrganizer(http.MethodPost, "/events/"+event.ID+"/vehicles", `{
		"code": "PKT-001",
		"teamName": "Packet Pioneers",
		"vehicleType": "SUV",
		"contactNumber": "+94771234567",
		"routeId": "`+route.ID+`",
		"crew": [
			{"name":"Nimal","phoneNumber":"0771234567","role":"navigator"},
			{"name":"Sunil","phoneNumber":"0777654321","role":"node"}
		]
	}`), http.StatusCreated)
	require.Len(t, vehicle.Crew, 2)

	// --- The first crew member joins, which creates the car's run. ---

	joined := decode[struct {
		TeamToken string `json:"teamToken"`
		Session   struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"session"`
		Crew []struct {
			CrewMemberID string `json:"crewMemberId"`
		} `json:"crew"`
	}](t, r.do(http.MethodPost, "/sessions/join",
		`{"vehicleId":"`+vehicle.ID+`","crewMemberId":"`+vehicle.Crew[0].ID+`","phoneLast4":"4567"}`, ""),
		http.StatusCreated)
	require.NotEmpty(t, joined.TeamToken)
	require.Equal(t, "bound", joined.Session.Status)
	require.Len(t, joined.Crew, 1)
	r.teamToken = joined.TeamToken

	// A teammate's phone joins the SAME run rather than being turned away —
	// this is what keeps a crew from being split across two sessions.
	teammate := decode[struct {
		TeamToken string `json:"teamToken"`
		Session   struct {
			ID string `json:"id"`
		} `json:"session"`
		Crew []struct {
			CrewMemberID string `json:"crewMemberId"`
		} `json:"crew"`
	}](t, r.do(http.MethodPost, "/sessions/join",
		`{"vehicleId":"`+vehicle.ID+`","crewMemberId":"`+vehicle.Crew[1].ID+`","phoneLast4":"4321"}`, ""),
		http.StatusCreated)
	require.Equal(t, joined.Session.ID, teammate.Session.ID, "both phones share one run")
	require.Len(t, teammate.Crew, 2, "the second phone sees both members aboard")

	// The last four digits are the whole of participant authentication, so a
	// wrong code must not mint a token. It is a 403, and the body is the
	// generic forbidden message — a probing client learns nothing about
	// whether the vehicle, the member or the digits were wrong.
	wrongCode := r.do(http.MethodPost, "/sessions/join",
		`{"vehicleId":"`+vehicle.ID+`","crewMemberId":"`+vehicle.Crew[0].ID+`","phoneLast4":"0000"}`, "")
	require.Equal(t, http.StatusForbidden, wrongCode.Code, "body: %s", wrongCode.Body.String())
	require.NotContains(t, wrongCode.Body.String(), "roster")

	// --- The crew drives into the waypoint and the task unlocks. ---

	ping := decode[struct {
		UnlockedTaskIDs   []string `json:"unlockedTaskIds"`
		CurrentWaypointID string   `json:"currentWaypointId"`
		Arrived           bool     `json:"arrived"`
	}](t, r.asCrew(http.MethodPost, "/sessions/me/location",
		`{"lat":6.8901,"lng":79.92,"accuracy":8}`), http.StatusOK)
	require.Equal(t, []string{task.ID}, ping.UnlockedTaskIDs)
	require.Equal(t, waypoint.ID, ping.CurrentWaypointID)
	require.False(t, ping.Arrived)

	// The crew's copy of the definition must not contain the answer.
	crewTask := decode[struct {
		Config map[string]any `json:"config"`
	}](t, r.asCrew(http.MethodGet, "/tasks/"+task.ID, ""), http.StatusOK)
	require.NotContains(t, crewTask.Config, "answer")
	require.Contains(t, crewTask.Config, "prompt")

	// --- They answer it. ---

	submitted := decode[struct {
		Correct       bool `json:"correct"`
		AwardedPoints int  `json:"awardedPoints"`
	}](t, r.asCrew(http.MethodPost, "/sessions/me/tasks/"+task.ID+"/submit",
		`{"answer":"API Integration"}`), http.StatusOK)
	require.True(t, submitted.Correct)
	require.Equal(t, 50, submitted.AwardedPoints)

	// --- Which shows up on the organizer's views. ---

	leaderboard := decode[[]struct {
		Rank        int    `json:"rank"`
		VehicleCode string `json:"vehicleCode"`
		TotalScore  int    `json:"totalScore"`
	}](t, r.asOrganizer(http.MethodGet, "/events/"+event.ID+"/leaderboard", ""), http.StatusOK)
	require.Len(t, leaderboard, 1)
	require.Equal(t, 1, leaderboard[0].Rank)
	require.Equal(t, "PKT-001", leaderboard[0].VehicleCode)
	require.Equal(t, 50, leaderboard[0].TotalScore)

	monitor := decode[struct {
		Vehicles []struct {
			VehicleCode string `json:"vehicleCode"`
			Done        int    `json:"done"`
			TotalTasks  int    `json:"totalTasks"`
		} `json:"vehicles"`
		OpenAlerts int `json:"openAlerts"`
	}](t, r.asOrganizer(http.MethodGet, "/events/"+event.ID+"/monitor", ""), http.StatusOK)
	require.Len(t, monitor.Vehicles, 1)
	require.Equal(t, 1, monitor.Vehicles[0].Done)
	require.Equal(t, 1, monitor.Vehicles[0].TotalTasks)
	require.Zero(t, monitor.OpenAlerts)

	// --- The crew reports a problem, and the organizer sees it. ---

	decode[struct {
		Source string `json:"source"`
	}](t, r.asCrew(http.MethodPost, "/sessions/me/alerts",
		`{"type":"breakdown","note":"Flat tyre","lat":6.8901,"lng":79.92}`), http.StatusCreated)

	openAlerts := decode[struct {
		TotalCount int `json:"totalCount"`
	}](t, r.asOrganizer(http.MethodPost, "/events/"+event.ID+"/alerts/search",
		`{"filters":{"openOnly":true}}`), http.StatusOK)
	require.Equal(t, 1, openAlerts.TotalCount)

	// --- They reach Pearl Bay, which finishes the run and issues vouchers. ---

	// Roughly 4.7 km from the waypoint, so the fix is only credible if the car
	// spent time covering it.
	r.drove(20 * time.Minute)

	arrival := decode[struct {
		Arrived bool `json:"arrived"`
	}](t, r.asCrew(http.MethodPost, "/sessions/me/location",
		`{"lat":6.848,"lng":79.928,"accuracy":8}`), http.StatusOK)
	require.True(t, arrival.Arrived)

	voucher := decode[struct {
		EntryCode   string `json:"entryCode"`
		LunchPasses int    `json:"lunchPasses"`
	}](t, r.asCrew(http.MethodGet, "/sessions/me/vouchers", ""), http.StatusOK)
	require.NotEmpty(t, voucher.EntryCode)
	require.Equal(t, 2, voucher.LunchPasses, "one pass per crew member aboard")

	// A finished session no longer accepts input.
	afterFinish := r.asCrew(http.MethodPost, "/sessions/me/tasks/"+task.ID+"/submit",
		`{"answer":"API Integration"}`)
	require.Equal(t, http.StatusConflict, afterFinish.Code)
}

// A crew must not be able to reach the organizer's surface with its team token.
func TestCrewCannotUseOrganizerEndpoints(t *testing.T) {
	r := newRally(t)

	event := decode[idResponse](t, r.asOrganizer(http.MethodPost, "/events", `{
		"name": "Rally", "eventDate": "2027-02-13", "startTime": "09:00",
		"start": {"lat":6.8901,"lng":79.92,"radiusM":40},
		"end": {"lat":6.848,"lng":79.928,"radiusM":30}
	}`), http.StatusCreated)
	r.asOrganizer(http.MethodPost, "/events/"+event.ID+"/publish", "")

	vehicle := decode[struct {
		ID   string `json:"id"`
		Crew []struct {
			ID string `json:"id"`
		} `json:"crew"`
	}](t, r.asOrganizer(http.MethodPost, "/events/"+event.ID+"/vehicles",
		`{"code":"PKT-001","teamName":"Team","crew":[{"name":"Nimal","phoneNumber":"0771234567"}]}`),
		http.StatusCreated)

	joined := decode[struct {
		TeamToken string `json:"teamToken"`
	}](t, r.do(http.MethodPost, "/sessions/join",
		`{"vehicleId":"`+vehicle.ID+`","crewMemberId":"`+vehicle.Crew[0].ID+`","phoneLast4":"4567"}`, ""),
		http.StatusCreated)
	r.teamToken = joined.TeamToken

	for _, path := range []string{
		"/events/" + event.ID + "/leaderboard",
		"/events/" + event.ID + "/monitor",
		"/users/me",
	} {
		t.Run(path, func(t *testing.T) {
			rec := r.asCrew(http.MethodGet, path, "")

			require.Equal(t, http.StatusForbidden, rec.Code, "body: %s", rec.Body.String())
		})
	}
}

// Crews cannot join an event the organizer has not published.
func TestJoinBeforePublishIsRejected(t *testing.T) {
	r := newRally(t)

	event := decode[idResponse](t, r.asOrganizer(http.MethodPost, "/events", `{
		"name": "Rally", "eventDate": "2027-02-13", "startTime": "09:00",
		"start": {"lat":6.8901,"lng":79.92,"radiusM":40},
		"end": {"lat":6.848,"lng":79.928,"radiusM":30}
	}`), http.StatusCreated)

	vehicle := decode[struct {
		ID   string `json:"id"`
		Crew []struct {
			ID string `json:"id"`
		} `json:"crew"`
	}](t, r.asOrganizer(http.MethodPost, "/events/"+event.ID+"/vehicles",
		`{"code":"PKT-001","teamName":"Team","crew":[{"name":"Nimal","phoneNumber":"0771234567"}]}`),
		http.StatusCreated)

	rec := r.do(http.MethodPost, "/sessions/join",
		`{"vehicleId":"`+vehicle.ID+`","crewMemberId":"`+vehicle.Crew[0].ID+`","phoneLast4":"4567"}`, "")

	require.Equal(t, http.StatusConflict, rec.Code, "body: %s", rec.Body.String())
}

// The CSV round trip is how a hundred-odd vehicles actually get provisioned.
func TestVehicleCSVRoundTrip(t *testing.T) {
	r := newRally(t)

	event := decode[idResponse](t, r.asOrganizer(http.MethodPost, "/events", `{
		"name": "Rally", "eventDate": "2027-02-13", "startTime": "09:00",
		"start": {"lat":6.8901,"lng":79.92,"radiusM":40},
		"end": {"lat":6.848,"lng":79.928,"radiusM":30}
	}`), http.StatusCreated)
	r.asOrganizer(http.MethodPost, "/events/"+event.ID+"/routes", `{"name":"Inland"}`)

	// Crew entries are "Name:phone": the number is mandatory because its last
	// four digits are how that member joins their car.
	body, contentType := csvUpload(t, "code,team_name,vehicle_type,contact_number,route_name,crew_names\n"+
		"PKT-001,Packet Pioneers,SUV,+94771234567,Inland,Nimal:0771234567|Sunil:0777654321\n"+
		"PKT-002,Byte Brigade,Van,+94777654321,Inland,Kamala:0779876543\n")

	req := httptest.NewRequest(http.MethodPost, "/events/"+event.ID+"/vehicles/import", body)
	req.Header.Set("Authorization", "Bearer "+r.organizer)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	r.handler.ServeHTTP(rec, req)

	imported := decode[struct {
		Imported int `json:"imported"`
	}](t, rec, http.StatusOK)
	require.Equal(t, 2, imported.Imported)

	exported := r.asOrganizer(http.MethodGet, "/events/"+event.ID+"/vehicles/export", "")
	require.Equal(t, http.StatusOK, exported.Code)
	require.Contains(t, exported.Body.String(),
		"PKT-001,Packet Pioneers,SUV,+94771234567,Inland,Nimal:0771234567|Sunil:0777654321")
}

// csvUpload builds the multipart body the web app's import control sends.
func csvUpload(t *testing.T, content string) (io.Reader, string) {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "vehicles.csv")
	require.NoError(t, err)
	_, err = part.Write([]byte(content))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	return &body, writer.FormDataContentType()
}
