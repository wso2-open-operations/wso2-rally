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
	"context"
	"encoding/json"
	"sort"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/alerts"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/tasks"
)

const (
	testVehicleID = "0123456789abcdef0123456789abcdef"
	testEventID   = "ffffffffffffffffffffffffffffffff"
	testRouteID   = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	crewA         = "crew-a"
	crewB         = "crew-b"
	// The last four digits of each roster number below, which is what a member
	// types on the join screen.
	crewAEmail = "nimal@wso2.com"
	crewBEmail = "ayesha@wso2.com"
)

// fakeRepo is an in-memory Repo. It enforces the one-live-session rule and the
// one-phone-per-member rule that the real schema enforces with unique indexes.
type fakeRepo struct {
	sessions  map[string]Session
	vouchers  map[string]Voucher
	event     EventInfo
	waypoints []WaypointGeo
	routeID   string
	// crew is the vehicle's roster, written the way real numbers are: spaced,
	// prefixed, inconsistent — because the last-four check has to cope with that.
	crew        []CrewRosterMember
	taskStates  []TaskState
	noVehicle   bool
	submittable map[string]SubmittableTask
	totals      map[string]int
	// submissions is keyed sessionID -> taskID, mirroring the unique index that
	// decides which phone won the task.
	submissions map[string]map[string]Submission
	// devices is keyed sessionID -> crewMemberID, mirroring uq_device_per_member.
	devices map[string]map[string]Device
	// visits is keyed sessionID -> waypointID, mirroring session_waypoint_visit.
	visits map[string]map[string]bool
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		sessions: map[string]Session{},
		vouchers: map[string]Voucher{},
		totals:   map[string]int{},
		submittable: map[string]SubmittableTask{
			"task-1": {
				ID: "task-1", EventID: testEventID, Code: "T1",
				Type: tasks.TypeInputSelect, Points: 50,
				Config: json.RawMessage(`{"answer":"API Integration"}`),
			},
		},
		event: EventInfo{
			Status:    "active",
			Cipher:    "API Integration",
			StartTime: "09:00",
			Start:     GeoCircle{Lat: 6.8901, Lng: 79.9200, RadiusM: 40, Placed: true},
			Finish:    GeoCircle{Lat: 6.8480, Lng: 79.9280, RadiusM: 30, Placed: true},
		},
		routeID: testRouteID,
		devices: map[string]map[string]Device{},
		crew: []CrewRosterMember{
			{ID: crewA, Name: "Nimal Perera", Email: crewAEmail, PhoneNumber: "+94 77 111 2233", Role: "navigator"},
			{ID: crewB, Name: "Ayesha Fernando", Email: crewBEmail, PhoneNumber: "071-999-8877", Role: "node"},
		},
		waypoints: []WaypointGeo{
			waypointAt("wp-1", 0, atKandy, WaypointTask{ID: "task-1", Type: tasks.TypeInputSelect}),
			waypointAt("wp-2", 1, LatLng{Lat: 6.8700, Lng: 79.9240},
				WaypointTask{ID: "task-2", Type: tasks.TypeRestLock}),
		},
	}
}

func (f *fakeRepo) JoinTargetOf(_ context.Context, vehicleID string) (JoinTarget, error) {
	if f.noVehicle {
		return JoinTarget{}, ErrVehicleNotFound
	}
	return JoinTarget{
		EventID: testEventID, RouteID: f.routeID,
		Code: "PKT-001", TeamName: "Packet Pioneers", Crew: f.crew,
	}, nil
}

func (f *fakeRepo) CreateSession(_ context.Context, s Session) error {
	for _, existing := range f.sessions {
		if existing.VehicleID == s.VehicleID && existing.Status.IsLive() {
			return ErrAlreadyBound
		}
	}
	f.sessions[s.ID] = s
	return nil
}

func (f *fakeRepo) LiveSessionOf(_ context.Context, vehicleID string) (Session, error) {
	for _, existing := range f.sessions {
		if existing.VehicleID == vehicleID && existing.Status.IsLive() {
			return existing, nil
		}
	}
	return Session{}, ErrNoLiveSession
}

// UpsertDevice mirrors the real upsert: one row per member, and a repeat join
// returns the row that already exists rather than adding a second phone.
func (f *fakeRepo) UpsertDevice(_ context.Context, sessionID, crewMemberID string) (Device, error) {
	if f.devices[sessionID] == nil {
		f.devices[sessionID] = map[string]Device{}
	}
	if existing, ok := f.devices[sessionID][crewMemberID]; ok {
		return existing, nil
	}

	name := crewMemberID
	for _, member := range f.crew {
		if member.ID == crewMemberID {
			name = member.Name
			break
		}
	}

	device := Device{
		ID:             "device-" + crewMemberID,
		SessionID:      sessionID,
		CrewMemberID:   crewMemberID,
		CrewMemberName: name,
		JoinedAt:       time.Now().UTC(),
	}
	f.devices[sessionID][crewMemberID] = device
	return device, nil
}

func (f *fakeRepo) DevicesOf(_ context.Context, sessionID string) ([]Device, error) {
	devices := make([]Device, 0, len(f.devices[sessionID]))
	for _, device := range f.devices[sessionID] {
		devices = append(devices, device)
	}
	// Map iteration is random; sort so assertions on order are stable.
	sort.Slice(devices, func(i, j int) bool { return devices[i].ID < devices[j].ID })
	return devices, nil
}

func (f *fakeRepo) DeviceOf(_ context.Context, deviceID string) (Device, error) {
	for _, bySession := range f.devices {
		for _, device := range bySession {
			if device.ID == deviceID {
				return device, nil
			}
		}
	}
	return Device{}, ErrDeviceNotFound
}

func (f *fakeRepo) TouchDevice(_ context.Context, deviceID string, at time.Time) error {
	for sessionID, bySession := range f.devices {
		for crewMemberID, device := range bySession {
			if device.ID == deviceID {
				device.LastSeenAt = &at
				f.devices[sessionID][crewMemberID] = device
				return nil
			}
		}
	}
	return ErrDeviceNotFound
}

// ClaimWaypointVisits mirrors the real edge detector: a boundary is "fresh" only
// the first time the car is inside it.
func (f *fakeRepo) ClaimWaypointVisits(
	_ context.Context, sessionID string, waypointIDs []string,
) ([]string, error) {
	if f.visits == nil {
		f.visits = map[string]map[string]bool{}
	}
	if f.visits[sessionID] == nil {
		f.visits[sessionID] = map[string]bool{}
	}

	var fresh []string
	for _, waypointID := range waypointIDs {
		if !f.visits[sessionID][waypointID] {
			f.visits[sessionID][waypointID] = true
			fresh = append(fresh, waypointID)
		}
	}
	return fresh, nil
}

func (f *fakeRepo) GetSession(_ context.Context, id string) (Session, error) {
	s, ok := f.sessions[id]
	if !ok {
		return Session{}, ErrNotFound
	}
	return s, nil
}

func (f *fakeRepo) UpdateSession(_ context.Context, s Session) error {
	if _, ok := f.sessions[s.ID]; !ok {
		return ErrNotFound
	}
	f.sessions[s.ID] = s
	return nil
}

func (f *fakeRepo) EventInfoOf(context.Context, string) (EventInfo, error) { return f.event, nil }

func (f *fakeRepo) WaypointsOf(context.Context, string) ([]WaypointGeo, error) {
	return f.waypoints, nil
}

func (f *fakeRepo) RouteIDOfVehicle(context.Context, string) (string, error) { return f.routeID, nil }

func (f *fakeRepo) TaskStatesOf(context.Context, string, string) ([]TaskState, error) {
	return f.taskStates, nil
}

func (f *fakeRepo) CreateVoucher(_ context.Context, v Voucher) error {
	f.vouchers[v.SessionID] = v
	return nil
}

func (f *fakeRepo) VoucherOf(_ context.Context, sessionID string) (Voucher, error) {
	v, ok := f.vouchers[sessionID]
	if !ok {
		return Voucher{}, ErrNoVoucher
	}
	return v, nil
}

func (f *fakeRepo) CrewSizeOf(context.Context, string) (int, error) { return len(f.crew), nil }

func (f *fakeRepo) VehicleCodeOf(context.Context, string) (string, error) { return "PKT-001", nil }

func (f *fakeRepo) SubmittableTaskOf(_ context.Context, taskID string) (SubmittableTask, error) {
	task, ok := f.submittable[taskID]
	if !ok {
		return SubmittableTask{}, ErrTaskNotOnThisRally
	}
	return task, nil
}

// SaveSubmission mirrors the real repository's race: the first attempt at a task
// claims it for the car, and a later one is told who won rather than overwriting
// the score. The unique index does this for real; here a map lookup stands in.
func (f *fakeRepo) SaveSubmission(_ context.Context, sub Submission) (int, error) {
	if f.submissions == nil {
		f.submissions = map[string]map[string]Submission{}
	}
	if f.submissions[sub.SessionID] == nil {
		f.submissions[sub.SessionID] = map[string]Submission{}
	}

	if won, taken := f.submissions[sub.SessionID][sub.TaskID]; taken {
		return 0, ErrTaskClaimedBy(TaskWinner{
			CrewMemberID:   won.CrewMemberID,
			CrewMemberName: f.crewNameOf(won.CrewMemberID),
			AwardedPoints:  won.AwardedPoints,
		})
	}
	f.submissions[sub.SessionID][sub.TaskID] = sub

	total := 0
	for _, stored := range f.submissions[sub.SessionID] {
		total += stored.AwardedPoints
	}
	f.totals[sub.SessionID] = total

	return total, nil
}

func (f *fakeRepo) crewNameOf(crewMemberID string) string {
	for _, member := range f.crew {
		if member.ID == crewMemberID {
			return member.Name
		}
	}

	return ""
}

// stubMinter issues a predictable token so tests can assert it reached the
// caller without decoding a JWT. It keys on the device rather than the session,
// because every phone in a car shares the session and two phones must not come
// away with the same token.
type stubMinter struct{ err error }

func (s stubMinter) Mint(claims authz.TeamClaims) (string, error) {
	if s.err != nil {
		return "", s.err
	}
	return "token-for-" + claims.DeviceID, nil
}

// recordingAlerts captures crew reports instead of persisting them.
type recordingAlerts struct {
	raised []alerts.RaiseAlertInput
	err    error
}

func (r *recordingAlerts) Raise(_ context.Context, in alerts.RaiseAlertInput) (alerts.Alert, error) {
	if r.err != nil {
		return alerts.Alert{}, r.err
	}
	r.raised = append(r.raised, in)
	return alerts.Alert{ID: "alert-1", VehicleID: in.VehicleID, Type: in.Type, Source: in.Source}, nil
}

type broadcastRecord struct {
	topic   string
	message any
}

func newService(t *testing.T) (*Service, *fakeRepo, *recordingAlerts, *[]broadcastRecord) {
	t.Helper()

	repo, alertRaiser := newFakeRepo(), &recordingAlerts{}
	var sent []broadcastRecord
	svc := NewService(repo, stubMinter{}, alertRaiser, func(topic string, message any) {
		sent = append(sent, broadcastRecord{topic: topic, message: message})
	})

	return svc, repo, alertRaiser, &sent
}

// joinAs puts one member's phone into the car and returns the result. The email
// is what the super app authenticated, so it is all a phone presents.
func joinAs(t *testing.T, svc *Service, email string) JoinResult {
	t.Helper()

	result, err := svc.Join(context.Background(), JoinInput{
		VehicleID: testVehicleID, CallerEmail: email,
	})
	require.NoError(t, err)
	require.NotEmpty(t, result.Token)

	return result
}

// bindOnce keeps the older tests readable: one phone aboard, session returned.
func bindOnce(t *testing.T, svc *Service) Session {
	t.Helper()

	return joinAs(t, svc, crewAEmail).Session
}

func TestService_Join_FirstMemberCreatesTheSession(t *testing.T) {
	svc, _, _, _ := newService(t)

	result := joinAs(t, svc, crewAEmail)

	require.Len(t, result.Session.ID, 32)
	require.Equal(t, StatusBound, result.Session.Status)
	require.Equal(t, testEventID, result.Session.EventID)
	require.NotNil(t, result.Session.BoundAt)
	require.Equal(t, crewA, result.Device.CrewMemberID)
	require.Equal(t, "Nimal Perera", result.Device.CrewMemberName)
	require.Equal(t, "token-for-"+result.Device.ID, result.Token)
	require.Len(t, result.Crew, 1)
}

// The inversion of the old one-active-phone rule: a second phone is not a
// conflict, it joins the run the first one started.
func TestService_Join_SecondMemberJoinsTheSameSession(t *testing.T) {
	svc, _, _, _ := newService(t)

	first := joinAs(t, svc, crewAEmail)
	second := joinAs(t, svc, crewBEmail)

	require.Equal(t, first.Session.ID, second.Session.ID, "the crew must share one run")
	require.NotEqual(t, first.Device.ID, second.Device.ID, "but not one device")
	require.NotEqual(t, first.Token, second.Token, "nor one token")
	require.Len(t, second.Crew, 2, "the second phone sees both aboard")
}

// A phone that reboots or clears its storage comes back to the same device row
// rather than becoming a fifth phone in a four-person car.
func TestService_Join_RejoinIsIdempotent(t *testing.T) {
	svc, _, _, _ := newService(t)

	first := joinAs(t, svc, crewAEmail)
	again := joinAs(t, svc, crewAEmail)

	require.Equal(t, first.Device.ID, again.Device.ID)
	require.Equal(t, first.Session.ID, again.Session.ID)
	require.Len(t, again.Crew, 1)
}

// The whole point of embedding: the phone says which car, the super app has
// already said who. The roster is what connects the two.
func TestService_Join_ResolvesTheMemberFromTheCallerEmail(t *testing.T) {
	svc, _, _, _ := newService(t)

	result := joinAs(t, svc, crewBEmail)

	require.Equal(t, crewB, result.Device.CrewMemberID)
	require.Equal(t, "Ayesha Fernando", result.Device.CrewMemberName)
}

// Being signed in proves who you are, not which car you are in. Picking the
// wrong vehicle must not put you in a crew you are not on.
func TestService_Join_RejectsACallerWhoIsNotOnThatRoster(t *testing.T) {
	svc, _, _, _ := newService(t)

	_, err := svc.Join(context.Background(), JoinInput{
		VehicleID: testVehicleID, CallerEmail: "stranger@wso2.com",
	})

	require.ErrorIs(t, err, ErrNotOnRoster)
	require.ErrorIs(t, err, apperr.ErrForbidden)
}

// Asgardeo may hand back a differently-cased address than the organizer typed
// into the roster, and locking a crew member out over capitalisation on rally
// morning would be indefensible.
func TestService_Join_MatchesTheEmailCaseInsensitively(t *testing.T) {
	svc, _, _, _ := newService(t)

	result := joinAs(t, svc, "  Nimal@WSO2.com ")

	require.Equal(t, crewA, result.Device.CrewMemberID)
}

func TestService_Join_UnknownVehicle(t *testing.T) {
	svc, repo, _, _ := newService(t)
	repo.noVehicle = true

	_, err := svc.Join(context.Background(), JoinInput{
		VehicleID: testVehicleID, CallerEmail: crewAEmail,
	})

	require.ErrorIs(t, err, ErrVehicleNotFound)
}

func TestService_Join_RejectsUnpublishedEvent(t *testing.T) {
	svc, repo, _, _ := newService(t)
	repo.event.Status = "setup"

	_, err := svc.Join(context.Background(), JoinInput{
		VehicleID: testVehicleID, CallerEmail: crewAEmail,
	})

	require.ErrorIs(t, err, ErrEventNotActive)
}

func TestService_Join_RequiresVehicleAndCaller(t *testing.T) {
	tests := map[string]JoinInput{
		"no vehicle":      {CallerEmail: crewAEmail},
		"no caller email": {VehicleID: testVehicleID},
	}
	for name, in := range tests {
		t.Run(name, func(t *testing.T) {
			svc, _, _, _ := newService(t)

			_, err := svc.Join(context.Background(), in)

			require.ErrorIs(t, err, apperr.ErrValidation)
		})
	}
}

func TestService_State_RevealsCipherOnlyWhenActive(t *testing.T) {
	svc, repo, _, _ := newService(t)
	session := bindOnce(t, svc)

	active, err := svc.State(context.Background(), session.ID, "")
	require.NoError(t, err)
	require.Equal(t, "API Integration", active.Cipher)

	repo.event.Status = "setup"
	setup, err := svc.State(context.Background(), session.ID, "")
	require.NoError(t, err)
	require.Empty(t, setup.Cipher, "the cipher stays off the wire until the event is live")
}

func TestService_State_ReportsTheNextWaypoint(t *testing.T) {
	svc, _, _, _ := newService(t)
	session := bindOnce(t, svc)

	state, err := svc.State(context.Background(), session.ID, "")

	require.NoError(t, err)
	require.Equal(t, "wp-1", state.NextWaypointID)
	require.Equal(t, "PKT-001", state.VehicleCode)
	require.Len(t, state.Waypoints, 2)
}

func TestService_State_UnknownSession(t *testing.T) {
	svc, _, _, _ := newService(t)

	_, err := svc.State(context.Background(), "missing", "")

	require.ErrorIs(t, err, ErrNotFound)
}

func TestService_Ping_ActivatesAndUnlocks(t *testing.T) {
	svc, repo, _, _ := newService(t)
	session := bindOnce(t, svc)

	result, err := svc.Ping(context.Background(), session.ID, "device-"+crewA, atKandy)

	require.NoError(t, err)
	require.Equal(t, []string{"task-1"}, result.UnlockedTaskIDs)
	require.Equal(t, "wp-1", result.CurrentWaypointID)

	stored := repo.sessions[session.ID]
	require.Equal(t, StatusActive, stored.Status, "the first ping starts the run")
	require.NotNil(t, stored.StartedAt)
	require.NotNil(t, stored.LastLat)
	require.InDelta(t, atKandy.Lat, *stored.LastLat, 1e-9)
}

func TestService_Ping_BroadcastsPositionToOrganizers(t *testing.T) {
	svc, _, _, sent := newService(t)
	session := bindOnce(t, svc)

	_, err := svc.Ping(context.Background(), session.ID, "device-"+crewA, atKandy)

	require.NoError(t, err)
	require.Contains(t, topicsOf(*sent), EventTopic(testEventID))
}

func TestService_Ping_BroadcastsRestLockToTheCrew(t *testing.T) {
	svc, _, _, sent := newService(t)
	session := bindOnce(t, svc)

	_, err := svc.Ping(context.Background(), session.ID, "device-"+crewA, LatLng{Lat: 6.8700, Lng: 79.9240})

	require.NoError(t, err)
	require.Contains(t, topicsOf(*sent), SessionTopic(session.ID))
}

func TestService_Ping_ArrivalFinishesAndIssuesVoucher(t *testing.T) {
	svc, repo, _, _ := newService(t)
	session := bindOnce(t, svc)

	result, err := svc.Ping(context.Background(), session.ID, "device-"+crewA, LatLng{Lat: 6.8480, Lng: 79.9280})

	require.NoError(t, err)
	require.True(t, result.Arrived)

	stored := repo.sessions[session.ID]
	require.Equal(t, StatusFinished, stored.Status)
	require.NotNil(t, stored.FinishedAt)

	voucher, err := svc.Vouchers(context.Background(), session.ID)
	require.NoError(t, err)
	require.NotEmpty(t, voucher.EntryCode)
	require.Equal(t, len(repo.crew), voucher.LunchPasses)
}

// Once a crew has finished, a stray ping must not reopen their run.
func TestService_Ping_AfterFinishIsRejected(t *testing.T) {
	svc, _, _, _ := newService(t)
	session := bindOnce(t, svc)
	_, err := svc.Ping(context.Background(), session.ID, "device-"+crewA, LatLng{Lat: 6.8480, Lng: 79.9280})
	require.NoError(t, err)

	_, err = svc.Ping(context.Background(), session.ID, "device-"+crewA, atKandy)

	require.ErrorIs(t, err, ErrSessionFinished)
}

func TestService_Ping_RejectsImpossibleCoordinates(t *testing.T) {
	svc, _, _, _ := newService(t)
	session := bindOnce(t, svc)

	_, err := svc.Ping(context.Background(), session.ID, "device-"+crewA, LatLng{Lat: 95, Lng: 0})

	require.ErrorIs(t, err, apperr.ErrValidation)
}

func TestService_Ping_OutsideEveryBoundaryStillRecordsPosition(t *testing.T) {
	svc, repo, _, _ := newService(t)
	session := bindOnce(t, svc)

	result, err := svc.Ping(context.Background(), session.ID, "device-"+crewA, nowhere)

	require.NoError(t, err)
	require.Empty(t, result.UnlockedTaskIDs)
	require.NotNil(t, repo.sessions[session.ID].LastPingAt)
}

func TestService_Finish_LocksTheSession(t *testing.T) {
	svc, repo, _, _ := newService(t)
	session := bindOnce(t, svc)

	finished, err := svc.Finish(context.Background(), session.ID)

	require.NoError(t, err)
	require.Equal(t, StatusFinished, finished.Status)
	require.Equal(t, StatusFinished, repo.sessions[session.ID].Status)
}

func TestService_Finish_IsIdempotent(t *testing.T) {
	svc, _, _, _ := newService(t)
	session := bindOnce(t, svc)
	first, err := svc.Finish(context.Background(), session.ID)
	require.NoError(t, err)

	second, err := svc.Finish(context.Background(), session.ID)

	require.NoError(t, err)
	require.Equal(t, first.FinishedAt.Unix(), second.FinishedAt.Unix())
}

func TestService_Vouchers_BeforeFinishing(t *testing.T) {
	svc, _, _, _ := newService(t)
	session := bindOnce(t, svc)

	_, err := svc.Vouchers(context.Background(), session.ID)

	require.ErrorIs(t, err, ErrNoVoucher)
	require.ErrorIs(t, err, apperr.ErrNotFound)
}

func TestService_RaiseCrewAlert_TagsTheSource(t *testing.T) {
	svc, _, alertRaiser, _ := newService(t)
	session := bindOnce(t, svc)
	lat, lng := 6.89, 79.92

	_, err := svc.RaiseCrewAlert(context.Background(), session.ID, CrewAlertInput{
		Type: "breakdown", Note: "Flat tyre", Lat: &lat, Lng: &lng,
	})

	require.NoError(t, err)
	require.Len(t, alertRaiser.raised, 1)
	require.Equal(t, alerts.SourceCrew, alertRaiser.raised[0].Source)
	require.Equal(t, testVehicleID, alertRaiser.raised[0].VehicleID)
	require.Equal(t, session.ID, alertRaiser.raised[0].RaisedBy)
}

func TestService_RaiseCrewAlert_UnknownSession(t *testing.T) {
	svc, _, _, _ := newService(t)

	_, err := svc.RaiseCrewAlert(context.Background(), "missing", CrewAlertInput{Type: "other"})

	require.ErrorIs(t, err, ErrNotFound)
}

func TestNextWaypointID(t *testing.T) {
	waypoints := []WaypointGeo{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	at := func(id string) *string { return &id }

	require.Equal(t, "a", nextWaypointID(waypoints, nil))
	require.Equal(t, "b", nextWaypointID(waypoints, at("a")))
	require.Empty(t, nextWaypointID(waypoints, at("c")), "there is nothing after the last waypoint")
	require.Empty(t, nextWaypointID(nil, nil))
}

func topicsOf(records []broadcastRecord) []string {
	topics := make([]string, 0, len(records))
	for _, record := range records {
		topics = append(topics, record.topic)
	}

	return topics
}

// The whole car has to learn a task unlocked, not just the phone that reported.
// Three of four crew members never ping, so this broadcast is their only signal.
func TestService_Ping_BroadcastsTaskUnlockedToTheWholeCar(t *testing.T) {
	svc, _, _, sent := newService(t)
	session := bindOnce(t, svc)

	_, err := svc.Ping(context.Background(), session.ID, "device-"+crewA, atKandy)

	require.NoError(t, err)
	require.Contains(t, topicsOf(*sent), SessionTopic(session.ID))
	require.Contains(t, messageTypes(*sent), "task_unlocked")
}

// A crew parked inside a waypoint pings every few seconds. Re-firing the unlock
// each time would restart a timed-trivia countdown on every ping.
func TestService_Ping_GeofenceEventFiresOnceNotEveryPing(t *testing.T) {
	svc, _, _, sent := newService(t)
	session := bindOnce(t, svc)
	ctx := context.Background()

	first, err := svc.Ping(ctx, session.ID, "device-"+crewA, atKandy)
	require.NoError(t, err)
	require.NotEmpty(t, first.UnlockedTaskIDs, "the crossing unlocks the waypoint's tasks")

	*sent = nil
	second, err := svc.Ping(ctx, session.ID, "device-"+crewA, atKandy)

	require.NoError(t, err)
	require.Empty(t, second.UnlockedTaskIDs, "still parked in the same circle, nothing is new")
	require.Empty(t, second.Events, "and no event is re-fired")
	require.NotContains(t, messageTypes(*sent), "task_unlocked")
	require.Equal(t, first.CurrentWaypointID, second.CurrentWaypointID,
		"where the car is stays true even when nothing is new")
}

// Reporting is open to any phone so the car stays covered while the driver is in
// Google Maps. That makes a plausibility gate the precondition: without it, a
// teammate's phone at the finish line would end the run for a car still out on
// the course.
func TestService_Ping_ImplausibleJumpDoesNotUnlockOrFinish(t *testing.T) {
	svc, repo, _, _ := newService(t)
	session := bindOnce(t, svc)
	ctx := context.Background()
	// Establish a real position first, so there is something to jump from.
	_, err := svc.Ping(ctx, session.ID, "device-"+crewA, LatLng{Lat: 6.9000, Lng: 79.9200})
	require.NoError(t, err)

	// The finish line, moments later. Reachable only by teleporting.
	result, err := svc.Ping(ctx, session.ID, "device-"+crewB, LatLng{Lat: 6.8480, Lng: 79.9280})

	require.NoError(t, err, "the fix is recorded, not rejected")
	require.False(t, result.Arrived, "but it must not finish the run")
	require.Empty(t, result.UnlockedTaskIDs)
	stored, err := repo.GetSession(ctx, session.ID)
	require.NoError(t, err)
	require.NotEqual(t, StatusFinished, stored.Status)
}

// The first fix of a run has nothing to compare against, so it must be accepted
// — otherwise no run could ever start.
func TestService_Ping_FirstFixIsAlwaysPlausible(t *testing.T) {
	svc, _, _, _ := newService(t)
	session := bindOnce(t, svc)

	result, err := svc.Ping(context.Background(), session.ID, "device-"+crewA, atKandy)

	require.NoError(t, err)
	require.NotEmpty(t, result.UnlockedTaskIDs)
}

// A phone counts as sharing location because it reported, not because it holds a
// role. This is what lets a crew see whether anyone is still covering the car.
func TestService_Ping_MarksThePhoneAsSharing(t *testing.T) {
	svc, _, _, _ := newService(t)
	joined := joinAs(t, svc, crewAEmail)

	_, err := svc.Ping(context.Background(), joined.Session.ID, joined.Device.ID, atKandy)
	require.NoError(t, err)

	state, err := svc.State(context.Background(), joined.Session.ID, joined.Device.ID)
	require.NoError(t, err)
	require.True(t, state.You.IsSharing(time.Now().UTC()), "the phone that pinged is sharing")
}

// isPlausibleMove used to wave a fix through whenever the elapsed time was zero
// or negative, on the reasoning that distance cannot be judged without time.
// That is backwards: nothing crosses real distance in no time, so "same
// instant" is the *strongest* evidence of a teleport, not an excuse to accept
// one. The old escape hatch also made the ping test above flaky — two pings
// inside one clock tick would finish the run.
func TestIsPlausibleMove_SameInstantAcceptsOnlyAStandstill(t *testing.T) {
	now := time.Date(2027, 2, 13, 9, 30, 0, 0, time.UTC)
	lat, lng := 6.9000, 79.9200
	atStartLine := Session{LastLat: &lat, LastLng: &lng, LastPingAt: &now}

	tests := map[string]struct {
		position LatLng
		want     bool
	}{
		// Two reports of one position, disagreeing by GPS jitter.
		"a metre away":      {LatLng{Lat: 6.90001, Lng: 79.92001}, true},
		"the finish line":   {LatLng{Lat: 6.8480, Lng: 79.9280}, false},
		"a kilometre north": {LatLng{Lat: 6.9090, Lng: 79.9200}, false},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, tt.want, isPlausibleMove(atStartLine, tt.position, now))
		})
	}
}

// A clock that steps backwards must not turn into a licence to teleport either.
func TestIsPlausibleMove_BackwardsClockStillRejectsAJump(t *testing.T) {
	pinged := time.Date(2027, 2, 13, 9, 30, 0, 0, time.UTC)
	lat, lng := 6.9000, 79.9200
	session := Session{LastLat: &lat, LastLng: &lng, LastPingAt: &pinged}

	earlier := pinged.Add(-2 * time.Second)

	require.False(t, isPlausibleMove(session, LatLng{Lat: 6.8480, Lng: 79.9280}, earlier))
}

// The first fix of a run has nothing to compare against and must be accepted,
// or no rally could ever start.
func TestIsPlausibleMove_FirstFixIsAlwaysAccepted(t *testing.T) {
	require.True(t, isPlausibleMove(Session{}, LatLng{Lat: 6.9, Lng: 79.92}, time.Now()))
}
