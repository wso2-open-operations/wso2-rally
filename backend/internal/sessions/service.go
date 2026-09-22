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
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/alerts"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/geo"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
)

// lunchPassesPerCrew is one pass per person aboard.
const lunchPassesPerCrew = 1

// entryCodeLength is how much of a fresh id becomes the printed entry code.
const entryCodeLength = 6

// Repo is the persistence contract for the in-car runtime.
type Repo interface {
	// JoinTargetOf returns what is needed to join a vehicle, or
	// ErrVehicleNotFound.
	JoinTargetOf(ctx context.Context, vehicleID string) (JoinTarget, error)
	// CreateSession inserts a session, returning ErrAlreadyBound when the
	// vehicle already has a live one.
	CreateSession(ctx context.Context, s Session) error
	// LiveSessionOf returns the vehicle's current run, or ErrNoLiveSession.
	// Join uses it both before creating one and after losing the race to
	// create it.
	LiveSessionOf(ctx context.Context, vehicleID string) (Session, error)
	// UpsertDevice adds this member's phone to the session, or returns the row
	// it already had. Re-joining is not an error: a phone that rebooted or a
	// borrowed replacement lands on the same device.
	UpsertDevice(ctx context.Context, sessionID, crewMemberID string) (Device, error)
	// DevicesOf lists every phone in the car, in join order.
	DevicesOf(ctx context.Context, sessionID string) ([]Device, error)
	// DeviceOf returns one phone, or ErrDeviceNotFound.
	DeviceOf(ctx context.Context, deviceID string) (Device, error)
	// TouchDevice records that a phone was heard from, which is what makes it
	// count as sharing location.
	TouchDevice(ctx context.Context, deviceID string, at time.Time) error
	// ClaimWaypointVisits records that the car entered these boundaries and
	// returns only the ones it had not entered before, so a geofence event
	// fires on the crossing rather than on every ping inside the circle.
	ClaimWaypointVisits(ctx context.Context, sessionID string, waypointIDs []string) ([]string, error)
	GetSession(ctx context.Context, id string) (Session, error)
	UpdateSession(ctx context.Context, s Session) error
	EventInfoOf(ctx context.Context, eventID string) (EventInfo, error)
	// WaypointsOf returns a route's waypoints reduced to geofence data.
	WaypointsOf(ctx context.Context, routeID string) ([]WaypointGeo, error)
	// RouteIDOfVehicle returns the course a vehicle is assigned to, or "".
	RouteIDOfVehicle(ctx context.Context, vehicleID string) (string, error)
	// TaskStatesOf lists a session's tasks with their submission status.
	TaskStatesOf(ctx context.Context, sessionID, routeID string) ([]TaskState, error)
	CreateVoucher(ctx context.Context, v Voucher) error
	VoucherOf(ctx context.Context, sessionID string) (Voucher, error)
	// CrewSizeOf counts the people aboard, which sets the lunch passes.
	CrewSizeOf(ctx context.Context, vehicleID string) (int, error)
	// VehicleCodeOf is used to label live-monitor broadcasts.
	VehicleCodeOf(ctx context.Context, vehicleID string) (string, error)
	// SubmittableTaskOf loads the definition needed to score an attempt.
	SubmittableTaskOf(ctx context.Context, taskID string) (SubmittableTask, error)
	// SaveSubmission stores an attempt and returns the session's recomputed
	// total, so a resubmission corrects the score instead of adding to it.
	SaveSubmission(ctx context.Context, sub Submission) (int, error)
}

// AlertRaiser is the slice of the alerts service this package needs, so a crew
// report lands in the same place an organizer's does.
type AlertRaiser interface {
	Raise(ctx context.Context, in alerts.RaiseAlertInput) (alerts.Alert, error)
}

// Broadcaster publishes to a topic. Two topics matter here: the event topic
// organizers watch, and the per-session topic the in-car phone subscribes to.
type Broadcaster func(topic string, message any)

// EventTopic is the channel organizers subscribe to for one event.
func EventTopic(eventID string) string { return "event:" + eventID }

// SessionTopic is the channel one in-car phone subscribes to.
func SessionTopic(sessionID string) string { return "session:" + sessionID }

// TokenMinter issues the credential a joined phone carries for the rest of the
// rally.
//
// It takes the whole claim set rather than a session id because the session is
// shared by every phone in the car: the token has to say which device and which
// member is holding it, or a handler could not attribute a submission.
type TokenMinter interface {
	Mint(claims authz.TeamClaims) (string, error)
}

// HMACTokenMinter mints team tokens with the configured shared secret.
type HMACTokenMinter struct {
	Secret string
	TTL    time.Duration
}

// Mint implements TokenMinter.
func (m HMACTokenMinter) Mint(claims authz.TeamClaims) (string, error) {
	return authz.MintTeamToken(m.Secret, claims, m.TTL)
}

// Service holds the in-car runtime rules.
type Service struct {
	repo      Repo
	minter    TokenMinter
	alerts    AlertRaiser
	broadcast Broadcaster
}

// NewService wires a Service. A nil broadcaster becomes a no-op so the service
// is usable before the realtime hub exists.
func NewService(repo Repo, minter TokenMinter, alertRaiser AlertRaiser, broadcast Broadcaster) *Service {
	if broadcast == nil {
		broadcast = func(string, any) {}
	}

	return &Service{repo: repo, minter: minter, alerts: alertRaiser, broadcast: broadcast}
}

// Join puts one crew member's phone into their vehicle's run and returns the
// team token it will carry.
//
// This is the zero-facilitator start: no one hands out credentials. The super
// app has already authenticated the person, so a member answers one question —
// which car am I in — and this trades their Asgardeo identity for a team token
// after finding them on that vehicle's roster by email.
//
// Every phone in the car shares one session. The first to arrive creates it and
// the rest find it, so the crew cannot end up split across two runs. Re-joining
// is deliberately not an error: a phone that rebooted, cleared its storage, or
// was swapped for a borrowed one lands back on the same device row.
func (s *Service) Join(ctx context.Context, in JoinInput) (JoinResult, error) {
	if in.VehicleID == "" {
		return JoinResult{}, apperr.Validationf("choose your vehicle")
	}
	if normalizeEmail(in.CallerEmail) == "" {
		// The token carried no email claim, so there is nothing to match a
		// roster row against. Never fall back to a body-supplied identity: a
		// phone that could name its own email could join any car it liked.
		return JoinResult{}, apperr.Validationf(
			"your account has no email address, so we cannot find you on a crew list")
	}

	target, err := s.repo.JoinTargetOf(ctx, in.VehicleID)
	if err != nil {
		return JoinResult{}, err
	}

	member, err := memberOf(target.Crew, in.CallerEmail)
	if err != nil {
		return JoinResult{}, err
	}

	event, err := s.repo.EventInfoOf(ctx, target.EventID)
	if err != nil {
		return JoinResult{}, err
	}
	if !event.IsActive() {
		return JoinResult{}, ErrEventNotActive
	}

	session, err := s.liveOrNewSession(ctx, target.EventID, in.VehicleID)
	if err != nil {
		return JoinResult{}, err
	}

	device, err := s.repo.UpsertDevice(ctx, session.ID, member.ID)
	if err != nil {
		return JoinResult{}, fmt.Errorf("add device for crew member %s: %w", member.ID, err)
	}

	crew, err := s.repo.DevicesOf(ctx, session.ID)
	if err != nil {
		return JoinResult{}, fmt.Errorf("list devices of session %s: %w", session.ID, err)
	}

	token, err := s.minter.Mint(authz.TeamClaims{
		SessionID:    session.ID,
		VehicleID:    session.VehicleID,
		DeviceID:     device.ID,
		CrewMemberID: device.CrewMemberID,
	})
	if err != nil {
		return JoinResult{}, fmt.Errorf("mint team token for device %s: %w", device.ID, err)
	}

	return JoinResult{Session: session, Device: device, Crew: crew, Token: token}, nil
}

// liveOrNewSession returns the vehicle's run, creating it if this is the first
// phone to arrive.
//
// The read-then-create is not a check: it is an optimisation for the common case
// where the session already exists. Correctness comes from the unique index, so
// two phones racing to create the same vehicle's session both end up with the
// one that won — the loser reads it back rather than reporting a conflict.
func (s *Service) liveOrNewSession(ctx context.Context, eventID, vehicleID string) (Session, error) {
	session, err := s.repo.LiveSessionOf(ctx, vehicleID)
	switch {
	case err == nil:
		return session, nil
	case !errors.Is(err, ErrNoLiveSession):
		return Session{}, err
	}

	now := time.Now().UTC()
	session = Session{
		ID:        store.NewID(),
		EventID:   eventID,
		VehicleID: vehicleID,
		Status:    StatusBound,
		BoundAt:   &now,
	}

	err = s.repo.CreateSession(ctx, session)
	switch {
	case err == nil:
		return session, nil
	case errors.Is(err, ErrAlreadyBound):
		// Another phone created it between our read and our insert. Theirs is
		// the car's session; take it.
		return s.repo.LiveSessionOf(ctx, vehicleID)
	default:
		return Session{}, err
	}
}

// memberOf finds the signed-in caller on the vehicle's roster.
//
// Matching is case- and space-insensitive: Asgardeo may hand back an address in
// a different case than the organizer typed into the roster, and locking a crew
// member out over capitalisation on rally morning would be indefensible.
func memberOf(roster []CrewRosterMember, callerEmail string) (CrewRosterMember, error) {
	wanted := normalizeEmail(callerEmail)
	for _, member := range roster {
		if normalizeEmail(member.Email) == wanted {
			return member, nil
		}
	}

	return CrewRosterMember{}, ErrNotOnRoster
}

// normalizeEmail lowercases and trims an address so two spellings of the same
// mailbox compare equal.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// State returns everything the micro app needs to decide which screen to show.
//
// deviceID is the calling phone, taken from its token. It is echoed back as
// You so a phone can tell itself apart from its teammates, and it is what makes
// this endpoint the recovery path for anything a phone missed over the
// WebSocket while it was backgrounded.
func (s *Service) State(ctx context.Context, sessionID, deviceID string) (SessionState, error) {
	session, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return SessionState{}, err
	}

	event, err := s.repo.EventInfoOf(ctx, session.EventID)
	if err != nil {
		return SessionState{}, err
	}
	target, err := s.repo.JoinTargetOf(ctx, session.VehicleID)
	if err != nil {
		return SessionState{}, err
	}

	waypoints, err := s.waypointsFor(ctx, session.VehicleID)
	if err != nil {
		return SessionState{}, err
	}

	crew, err := s.repo.DevicesOf(ctx, session.ID)
	if err != nil {
		return SessionState{}, fmt.Errorf("list devices of session %s: %w", session.ID, err)
	}

	state := SessionState{
		Session:      session,
		VehicleCode:  target.Code,
		TeamName:     target.TeamName,
		EventStatus:  event.Status,
		StartTime:    event.StartTime,
		StartCircle:  event.Start,
		FinishCircle: event.Finish,
		Waypoints:    waypoints,
		Crew:         crew,
	}
	for _, device := range crew {
		if device.ID == deviceID {
			state.You = device
			break
		}
	}
	// The cipher is part of the start signal; withholding it until the event
	// is active keeps it off the wire during setup.
	if event.IsActive() {
		state.Cipher = event.Cipher
	}
	state.NextWaypointID = nextWaypointID(waypoints, session.CurrentWaypointID)

	return state, nil
}

// Ping records a reported position and answers with what the crew may now do.
//
// The client never decides whether it is inside a boundary: it reports where
// it is, and this method runs the geofence maths server-side.
func (s *Service) Ping(ctx context.Context, sessionID, deviceID string, position LatLng) (PingResult, error) {
	if err := validatePosition(position); err != nil {
		return PingResult{}, err
	}

	session, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return PingResult{}, err
	}
	if session.Status == StatusFinished {
		return PingResult{}, ErrSessionFinished
	}

	event, err := s.repo.EventInfoOf(ctx, session.EventID)
	if err != nil {
		return PingResult{}, err
	}
	waypoints, err := s.waypointsFor(ctx, session.VehicleID)
	if err != nil {
		return PingResult{}, err
	}

	now := time.Now().UTC()

	// Any phone in the car may report, which is what keeps the car covered when
	// the driver is in Google Maps — but it also means a phone that is not in the
	// car can report. A fix implying an impossible speed is recorded and then
	// ignored, rather than being allowed to unlock a waypoint the car never
	// reached or, worse, trip the finish geofence and end the run early.
	var result PingResult
	plausible := isPlausibleMove(session, position, now)
	if plausible {
		result = EvaluatePing(position, waypoints, event.Finish)
		if err := s.claimVisits(ctx, session.ID, &result); err != nil {
			return PingResult{}, err
		}
	} else {
		s.logImplausible(session, position, now)
	}

	session.LastLat, session.LastLng, session.LastPingAt = &position.Lat, &position.Lng, &now
	// The first ping past the start grid is what makes a bound crew active.
	if session.Status == StatusBound && plausible {
		session.Status = StatusActive
		session.StartedAt = &now
	}
	if result.CurrentWaypointID != "" {
		waypointID := result.CurrentWaypointID
		session.CurrentWaypointID = &waypointID
	}

	if result.Arrived {
		if err := s.finish(ctx, &session, now); err != nil {
			return PingResult{}, err
		}
	} else if err := s.repo.UpdateSession(ctx, session); err != nil {
		return PingResult{}, fmt.Errorf("update session %s: %w", sessionID, err)
	}

	// Recording that this phone was heard from is what makes it count as sharing
	// location. Not fatal: the position is already stored, and losing the
	// timestamp costs a "who is sharing" indicator, not the crew's progress.
	if deviceID != "" {
		if err := s.repo.TouchDevice(ctx, deviceID, now); err != nil {
			s.logger().Warn("could not record that a phone reported",
				"device_id", deviceID, "session_id", sessionID, "error", err)
		}
	}

	s.publishPosition(ctx, session, position)
	s.broadcastSessionEvents(session.ID, result)

	return result, nil
}

// ListTasks returns the crew's task list with each task's submission status.
func (s *Service) ListTasks(ctx context.Context, sessionID string) ([]TaskState, error) {
	session, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	routeID, err := s.repo.RouteIDOfVehicle(ctx, session.VehicleID)
	if err != nil {
		return nil, err
	}

	states, err := s.repo.TaskStatesOf(ctx, sessionID, routeID)
	if err != nil {
		return nil, fmt.Errorf("list tasks of session %s: %w", sessionID, err)
	}

	return states, nil
}

// RaiseCrewAlert files a problem reported from the car, tagged as crew-sourced
// so organizers can tell it apart from one they filed themselves.
func (s *Service) RaiseCrewAlert(ctx context.Context, sessionID string, in CrewAlertInput) (alerts.Alert, error) {
	session, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return alerts.Alert{}, err
	}

	raised, err := s.alerts.Raise(ctx, alerts.RaiseAlertInput{
		VehicleID: session.VehicleID,
		Type:      alerts.Type(in.Type),
		Note:      in.Note,
		Source:    alerts.SourceCrew,
		RaisedBy:  sessionID,
		Lat:       in.Lat,
		Lng:       in.Lng,
	})
	if err != nil {
		return alerts.Alert{}, err
	}

	return raised, nil
}

// Finish ends a run explicitly. Arrival at the finish geofence does the same
// thing automatically, so this is the manual fallback.
func (s *Service) Finish(ctx context.Context, sessionID string) (Session, error) {
	session, err := s.repo.GetSession(ctx, sessionID)
	if err != nil {
		return Session{}, err
	}
	if session.Status == StatusFinished {
		return session, nil // Finishing twice is a no-op, not an error.
	}

	if err := s.finish(ctx, &session, time.Now().UTC()); err != nil {
		return Session{}, err
	}

	return session, nil
}

// Vouchers returns what the crew collects at Pearl Bay.
func (s *Service) Vouchers(ctx context.Context, sessionID string) (Voucher, error) {
	return s.repo.VoucherOf(ctx, sessionID)
}

// finish locks the score, issues the voucher, and tells both topics.
func (s *Service) finish(ctx context.Context, session *Session, at time.Time) error {
	session.Status = StatusFinished
	session.FinishedAt = &at

	if err := s.repo.UpdateSession(ctx, *session); err != nil {
		return fmt.Errorf("finish session %s: %w", session.ID, err)
	}

	if err := s.issueVoucher(ctx, *session); err != nil {
		return err
	}

	s.broadcast(SessionTopic(session.ID), map[string]any{"type": string(EventArrival)})

	return nil
}

// issueVoucher creates the crew's finish-line voucher, unless one already
// exists from an earlier finish.
func (s *Service) issueVoucher(ctx context.Context, session Session) error {
	if _, err := s.repo.VoucherOf(ctx, session.ID); err == nil {
		return nil
	}

	crewSize, err := s.repo.CrewSizeOf(ctx, session.VehicleID)
	if err != nil {
		return fmt.Errorf("count crew of vehicle %s: %w", session.VehicleID, err)
	}
	code := store.NewID()

	voucher := Voucher{
		ID:          code,
		SessionID:   session.ID,
		EntryCode:   strings.ToUpper(code[:entryCodeLength]),
		LockerID:    strings.ToUpper(session.VehicleID[:entryCodeLength]),
		LunchPasses: crewSize * lunchPassesPerCrew,
	}
	if err := s.repo.CreateVoucher(ctx, voucher); err != nil {
		return fmt.Errorf("issue voucher for session %s: %w", session.ID, err)
	}

	return nil
}

// waypointsFor loads the geofence data of the course a vehicle is running. A
// vehicle with no route assigned simply has no waypoints.
func (s *Service) waypointsFor(ctx context.Context, vehicleID string) ([]WaypointGeo, error) {
	routeID, err := s.repo.RouteIDOfVehicle(ctx, vehicleID)
	if err != nil {
		return nil, err
	}
	if routeID == "" {
		return nil, nil
	}

	waypoints, err := s.repo.WaypointsOf(ctx, routeID)
	if err != nil {
		return nil, fmt.Errorf("load waypoints of route %s: %w", routeID, err)
	}

	return waypoints, nil
}

// maxPlausibleSpeedMPS is the fastest a rally car could credibly be moving
// between two fixes: 60 m/s, about 216 km/h.
//
// Generous on purpose. The point is not to police driving; it is to reject a fix
// that cannot have come from this car — a crew member who took a taxi ahead to
// the pavilion, or a phone left at the finish-line desk. Without this, any phone
// reporting from inside the finish geofence would end the run for a car still
// 60 km out.
const maxPlausibleSpeedMPS = 60.0

// sameInstantToleranceM is how far apart two fixes stamped the same instant may
// be and still be believed: one second of travel at the ceiling above.
//
// Two reports of one position legitimately disagree by GPS jitter, so the
// tolerance cannot be zero. A kilometre apart in no time is a teleport whatever
// the timestamps claim.
const sameInstantToleranceM = maxPlausibleSpeedMPS

// isPlausibleMove reports whether the car could have travelled from its last
// known fix to this one in the elapsed time.
//
// The first fix of a run has nothing to compare against and is always accepted:
// there is no prior position, and refusing it would mean no run could ever start.
func isPlausibleMove(session Session, position LatLng, now time.Time) bool {
	if session.LastLat == nil || session.LastLng == nil || session.LastPingAt == nil {
		return true
	}

	metres := geo.HaversineMeters(*session.LastLat, *session.LastLng, position.Lat, position.Lng)

	elapsed := now.Sub(*session.LastPingAt).Seconds()
	if elapsed <= 0 {
		// Zero or negative elapsed time: two fixes stamped the same instant, or
		// a clock that stepped backwards. This used to accept the fix on the
		// grounds that distance cannot be judged without time — which is
		// backwards. Nothing crosses real distance in no time, so "same instant"
		// is the strongest evidence of a teleport there is, and the only
		// credible fix is one that has barely moved.
		//
		// A genuine backwards clock step therefore costs one dropped fix out of
		// a stream of them, which is the cheaper mistake.
		return metres <= sameInstantToleranceM
	}

	return metres/elapsed <= maxPlausibleSpeedMPS
}

// logImplausible records a rejected fix. It is logged rather than dropped
// quietly, because the likely causes — a phone that left the car, a spoofed
// location — are things an organizer would want to know about after the event.
func (s *Service) logImplausible(session Session, position LatLng, now time.Time) {
	elapsed := now.Sub(*session.LastPingAt).Seconds()
	metres := geo.HaversineMeters(*session.LastLat, *session.LastLng, position.Lat, position.Lng)

	s.logger().Warn("ignored an implausible position for geofencing",
		"session_id", session.ID,
		"vehicle_id", session.VehicleID,
		"metres", metres,
		"seconds", elapsed,
	)
}

// claimVisits reduces the evaluated result to the boundaries the car has not
// been inside before.
//
// EvaluatePing is level-triggered: it reports every circle the car is currently
// in, on every ping. A crew parked inside a waypoint would therefore re-unlock
// its tasks every few seconds, restarting a timed-trivia countdown each time.
// The visit table turns that into an edge.
func (s *Service) claimVisits(ctx context.Context, sessionID string, result *PingResult) error {
	entered := make([]string, 0, len(result.Events))
	for _, event := range result.Events {
		if event.Type == EventGeofenceEnter && event.WaypointID != "" {
			entered = append(entered, event.WaypointID)
		}
	}
	if len(entered) == 0 {
		return nil
	}

	fresh, err := s.repo.ClaimWaypointVisits(ctx, sessionID, entered)
	if err != nil {
		return fmt.Errorf("claim waypoint visits for session %s: %w", sessionID, err)
	}

	// Keep only the events and unlocks belonging to a boundary crossed for the
	// first time. CurrentWaypointID and Arrived are unaffected: where the car is
	// does not stop being true just because we have said so before.
	firstTime := make(map[string]bool, len(fresh))
	for _, waypointID := range fresh {
		firstTime[waypointID] = true
	}

	keptEvents := make([]PingEvent, 0, len(result.Events))
	for _, event := range result.Events {
		if event.WaypointID != "" && !firstTime[event.WaypointID] {
			continue
		}
		keptEvents = append(keptEvents, event)
	}
	result.Events = keptEvents

	if len(fresh) == 0 {
		result.UnlockedTaskIDs = nil
	}

	return nil
}

func (s *Service) logger() *slog.Logger { return slog.Default() }

// publishPosition pushes the vehicle's position to the organizer's monitor.
// A failure here costs a map marker, not the crew's ping, so it is not fatal.
func (s *Service) publishPosition(ctx context.Context, session Session, position LatLng) {
	code, err := s.repo.VehicleCodeOf(ctx, session.VehicleID)
	if err != nil {
		return
	}

	s.broadcast(EventTopic(session.EventID), map[string]any{
		"type":        "vehicle_position",
		"vehicleCode": code,
		"lat":         position.Lat,
		"lng":         position.Lng,
	})
}

// broadcastSessionEvents tells the whole car what the last position meant.
//
// This is load-bearing, not a convenience. Only one phone reports location, so
// the other three learn that a task unlocked *only* from here — without the
// broadcast, three of four crew members would sit looking at a stale screen
// while the car drove past the checkpoint.
func (s *Service) broadcastSessionEvents(sessionID string, result PingResult) {
	topic := SessionTopic(sessionID)

	if len(result.UnlockedTaskIDs) > 0 {
		s.broadcast(topic, map[string]any{
			"type":              "task_unlocked",
			"taskIds":           result.UnlockedTaskIDs,
			"currentWaypointId": result.CurrentWaypointID,
		})
	}

	for _, event := range result.Events {
		switch event.Type {
		case EventRestLock, EventTrivia:
			s.broadcast(topic, map[string]any{
				"type":   string(event.Type),
				"taskId": event.TaskID,
			})
		}
	}
}

// nextWaypointID is the first waypoint after the one the crew is at, or the
// very first when they have not reached any.
func nextWaypointID(waypoints []WaypointGeo, currentID *string) string {
	if len(waypoints) == 0 {
		return ""
	}
	if currentID == nil {
		return waypoints[0].ID
	}

	for i, waypoint := range waypoints {
		if waypoint.ID == *currentID && i+1 < len(waypoints) {
			return waypoints[i+1].ID
		}
	}

	return ""
}

func validatePosition(p LatLng) error {
	if p.Lat < -90 || p.Lat > 90 {
		return apperr.Validationf("latitude must be between -90 and 90")
	}
	if p.Lng < -180 || p.Lng > 180 {
		return apperr.Validationf("longitude must be between -180 and 180")
	}

	return nil
}
