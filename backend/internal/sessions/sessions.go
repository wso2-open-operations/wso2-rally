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

// Package sessions is the in-car runtime: one phone binds itself to a vehicle
// and its crew, streams position, unlocks and submits tasks, reports problems,
// and finishes at Pearl Bay.
//
// Binding is what authenticates a crew — there is no participant login — so
// the team token minted here is the only credential the micro app holds.
package sessions

import (
	"fmt"
	"slices"
	"time"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
)

// Sentinel errors, wrapping the shared categories.
var (
	// ErrNotFound means no session exists with the requested id.
	ErrNotFound = fmt.Errorf("%w: session", apperr.ErrNotFound)
	// ErrVehicleNotFound means the vehicle being joined does not exist.
	ErrVehicleNotFound = fmt.Errorf("%w: vehicle", apperr.ErrNotFound)
	// ErrAlreadyBound means this vehicle already has a live session.
	//
	// It is no longer returned to a caller. Joining races every other phone in
	// the car to create the one session they will share, and the loser of that
	// race wants the winner's session — so Join catches this and re-reads rather
	// than reporting a conflict.
	ErrAlreadyBound = fmt.Errorf("%w: this vehicle already has a live session", apperr.ErrConflict)
	// ErrEventNotActive means the event has not been published, so crews
	// cannot join it yet.
	ErrEventNotActive = fmt.Errorf("%w: this event is not open for crews yet", apperr.ErrConflict)
	// ErrNotOnRoster means the signed-in caller is not on the roster of the
	// vehicle they picked.
	//
	// Deliberately about the *vehicle*, not the person: being signed in proves
	// who they are, so the only thing left to be wrong is the car. Saying so
	// points them at the fix instead of at their own account.
	ErrNotOnRoster = fmt.Errorf(
		"%w: you are not on the crew list for that vehicle — check you picked the right one",
		apperr.ErrForbidden)
	// ErrDeviceNotFound means the token names a phone that is no longer in the
	// session — its row was removed, so the phone must join again.
	ErrDeviceNotFound = fmt.Errorf("%w: device", apperr.ErrNotFound)
	// ErrSessionFinished means the session is over and no longer accepts input.
	ErrSessionFinished = fmt.Errorf("%w: this session has already finished", apperr.ErrConflict)
	// ErrNoVoucher means the session has not finished, so nothing was issued.
	ErrNoVoucher = fmt.Errorf("%w: voucher", apperr.ErrNotFound)
	// ErrNoLiveSession means the vehicle has no run under way. It is an internal
	// signal — Join reads it as "you are the first phone here" — and never
	// reaches a caller.
	ErrNoLiveSession = fmt.Errorf("%w: live session", apperr.ErrNotFound)
)

// Status is where a session is in its lifecycle.
type Status string

const (
	// StatusBound is a phone paired to a vehicle, waiting at the start grid.
	StatusBound Status = "bound"
	// StatusActive is a crew under way.
	StatusActive Status = "active"
	// StatusFinished is a crew that reached Pearl Bay; its score is locked.
	StatusFinished Status = "finished"
)

var allStatuses = []Status{StatusBound, StatusActive, StatusFinished}

// IsValid reports whether s is a known session status.
func (s Status) IsValid() bool { return slices.Contains(allStatuses, s) }

// IsLive reports whether the session still accepts input.
func (s Status) IsLive() bool { return s == StatusBound || s == StatusActive }

// Session is one vehicle's run of the rally, shared by every phone in the car.
type Session struct {
	ID        string
	EventID   string
	VehicleID string
	Status    Status
	// CurrentWaypointID is the furthest boundary the vehicle has been inside.
	CurrentWaypointID *string
	TotalScore        int
	BoundAt           *time.Time
	StartedAt         *time.Time
	FinishedAt        *time.Time
	// Last position reported, kept for the organizer's live monitor.
	LastLat    *float64
	LastLng    *float64
	LastPingAt *time.Time
}

// CrewRosterMember is one person on a vehicle's roster, as the join check needs
// them: the address the super app authenticated, and the name to show once it
// matches.
type CrewRosterMember struct {
	ID    string
	Name  string
	Email string
	// PhoneNumber is no longer part of authentication — the super app is. It is
	// carried so an organizer can call a car that goes quiet.
	PhoneNumber string
	Role        string
}

// JoinTarget is what the repository knows about a vehicle at join time.
type JoinTarget struct {
	EventID  string
	RouteID  string
	Code     string
	TeamName string
	Crew     []CrewRosterMember
}

// Device is one phone in the car.
type Device struct {
	ID             string
	SessionID      string
	CrewMemberID   string
	CrewMemberName string
	JoinedAt       time.Time
	// LastSeenAt is the last time this phone reported anything. Whether it is
	// currently sharing location is read from this, not from a stored role.
	LastSeenAt *time.Time
}

// IsSharing reports whether this phone has been heard from recently enough to
// count as covering the car's position.
func (d Device) IsSharing(now time.Time) bool {
	return d.LastSeenAt != nil && now.Sub(*d.LastSeenAt) <= SharingWindow
}

// SharingWindow is how recently a phone must have reported to count as sharing
// location.
//
// Generous on purpose: a phone reports only while its app is in the foreground
// and awake, so brief gaps are normal and treating one as "stopped sharing"
// would flap. What matters is that a crew can see, before someone pockets their
// phone, whether anyone else is still covering the car.
const SharingWindow = 90 * time.Second

// JoinInput is a request to put one crew member's phone into their car's run.
type JoinInput struct {
	VehicleID string
	// CallerEmail is the address on the super app's Asgardeo token. It comes
	// from the verified identity, never from the request body — a phone that
	// could name its own email could join any car it liked.
	CallerEmail string
}

// JoinResult is what a phone gets back when it joins.
type JoinResult struct {
	Session Session
	Device  Device
	// Crew is every phone in the car, so the joining one can show who is
	// aboard and who is currently sharing location.
	Crew  []Device
	Token string
}

// EventInfo is the slice of an event the in-car runtime needs.
type EventInfo struct {
	Status string
	// Cipher is withheld until the event is active and the start signal fires.
	Cipher    string
	StartTime string
	Finish    GeoCircle
	Start     GeoCircle
}

// IsActive reports whether crews may bind and run.
func (e EventInfo) IsActive() bool { return e.Status == "active" }

// TaskState is one task as the crew sees it: the definition's identity plus
// whether the car has already completed it.
type TaskState struct {
	TaskID     string
	WaypointID string
	Code       string
	Title      string
	Type       string
	Points     int
	Status     string
	Awarded    int
	// CompletedBy names the crew member who won this task, so every phone can
	// show who got there first. Empty while the task is unanswered.
	CompletedBy string
}

// SessionState is everything the micro app needs to render its current screen.
type SessionState struct {
	Session     Session
	VehicleCode string
	TeamName    string
	EventStatus string
	StartTime   string
	// Cipher is empty until the event is active.
	Cipher       string
	StartCircle  GeoCircle
	FinishCircle GeoCircle
	Waypoints    []WaypointGeo
	// NextWaypointID is the first waypoint the crew has not reached.
	NextWaypointID string
	// Crew is every phone in the car. A phone renders "who is aboard" and "who
	// is sharing location" from this, and warns its owner before they walk away
	// with the only phone still reporting.
	Crew []Device
	// You is the calling phone's own row, so it can tell itself apart from the
	// rest of Crew without matching on ids client-side.
	You Device
}

// Voucher is what a crew collects at the finish.
type Voucher struct {
	ID          string
	SessionID   string
	EntryCode   string
	LockerID    string
	LunchPasses int
}

// CrewAlertInput is a problem reported from the in-car app.
type CrewAlertInput struct {
	Type string
	Note string
	Lat  *float64
	Lng  *float64
}
