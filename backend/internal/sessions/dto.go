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

import "time"

// SessionDTO is a session on the wire.
type SessionDTO struct {
	ID                string   `json:"id"`
	EventID           string   `json:"eventId"`
	VehicleID         string   `json:"vehicleId"`
	Status            string   `json:"status"`
	CurrentWaypointID *string  `json:"currentWaypointId"`
	TotalScore        int      `json:"totalScore"`
	BoundAt           *string  `json:"boundAt"`
	StartedAt         *string  `json:"startedAt"`
	FinishedAt        *string  `json:"finishedAt"`
	LastLat           *float64 `json:"lastLat"`
	LastLng           *float64 `json:"lastLng"`
}

// CircleDTO is a geofence on the wire. Placed is false while the organizer has
// not dropped the pin, and the micro app hides the boundary until it is.
type CircleDTO struct {
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	RadiusM int     `json:"radiusM"`
	Placed  bool    `json:"placed"`
}

// WaypointDTO is a waypoint as the crew sees it: where it is, and which tasks
// wait inside it.
type WaypointDTO struct {
	ID      string    `json:"id"`
	Order   int       `json:"order"`
	Circle  CircleDTO `json:"circle"`
	TaskIDs []string  `json:"taskIds"`
}

// SessionStateDTO is the whole in-car view: the session, the crew's course,
// and the two geofences that bracket it.
type SessionStateDTO struct {
	Session        SessionDTO    `json:"session"`
	VehicleCode    string        `json:"vehicleCode"`
	TeamName       string        `json:"teamName"`
	EventStatus    string        `json:"eventStatus"`
	StartTime      string        `json:"startTime"`
	Cipher         string        `json:"cipher"`
	StartCircle    CircleDTO     `json:"startCircle"`
	FinishCircle   CircleDTO     `json:"finishCircle"`
	Waypoints      []WaypointDTO `json:"waypoints"`
	NextWaypointID string        `json:"nextWaypointId"`
	// Crew is every phone in the car; You is the calling one.
	Crew []DeviceDTO `json:"crew"`
	You  DeviceDTO   `json:"you"`
	// SharingCount is how many phones are currently reporting position. The app
	// warns its owner when this is 1 and it is them, before they pocket the
	// phone the whole car is relying on.
	SharingCount int `json:"sharingCount"`
}

// JoinRequest is the POST /sessions/join body.
type JoinRequest struct {
	VehicleID string `json:"vehicleId"`
}

// DeviceDTO is one phone in the car.
//
// It carries no phone number. The roster's numbers exist so organizers can call
// a crew and so a member can prove who they are; neither needs them on a phone,
// and a crew list that shipped them would hand every teammate's number to
// anyone who joined the car.
type DeviceDTO struct {
	ID             string  `json:"id"`
	CrewMemberID   string  `json:"crewMemberId"`
	CrewMemberName string  `json:"crewMemberName"`
	JoinedAt       string  `json:"joinedAt"`
	LastSeenAt     *string `json:"lastSeenAt"`
	// Sharing is whether this phone is currently reporting the car's position.
	// Computed server-side so every phone in the car agrees on the answer.
	Sharing bool `json:"sharing"`
}

// JoinResponse hands the phone its credential for the rest of the rally.
type JoinResponse struct {
	TeamToken string     `json:"teamToken"`
	Session   SessionDTO `json:"session"`
	// Device is this phone; Crew is every phone in the car, including this one.
	Device DeviceDTO   `json:"device"`
	Crew   []DeviceDTO `json:"crew"`
}

// LocationRequest is the POST /sessions/me/location body.
type LocationRequest struct {
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Accuracy float64 `json:"accuracy"`
}

// PingEventDTO is one thing the backend noticed about a reported position.
type PingEventDTO struct {
	Type       string `json:"type"`
	WaypointID string `json:"waypointId,omitempty"`
	TaskID     string `json:"taskId,omitempty"`
}

// PingResponse tells the phone what just became possible.
type PingResponse struct {
	UnlockedTaskIDs   []string       `json:"unlockedTaskIds"`
	CurrentWaypointID string         `json:"currentWaypointId"`
	Arrived           bool           `json:"arrived"`
	Events            []PingEventDTO `json:"events"`
}

// TaskStateDTO is one task in the crew's list.
type TaskStateDTO struct {
	TaskID     string `json:"taskId"`
	WaypointID string `json:"waypointId"`
	Code       string `json:"code"`
	Title      string `json:"title"`
	Type       string `json:"type"`
	Points     int    `json:"points"`
	Status     string `json:"status"`
	Awarded    int    `json:"awardedPoints"`
	// CompletedBy names the teammate who answered this first, so every phone can
	// close the task showing who got there. Empty while it is unanswered.
	CompletedBy string `json:"completedBy"`
}

// CrewAlertRequest is the POST /sessions/me/alerts body.
type CrewAlertRequest struct {
	Type string   `json:"type"`
	Note string   `json:"note"`
	Lat  *float64 `json:"lat"`
	Lng  *float64 `json:"lng"`
}

// SubmitResultDTO is the scored outcome of one task attempt.
type SubmitResultDTO struct {
	Correct       bool   `json:"correct"`
	AwardedPoints int    `json:"awardedPoints"`
	Detail        string `json:"detail"`
}

// VoucherDTO is what the crew collects at Pearl Bay.
type VoucherDTO struct {
	EntryCode   string `json:"entryCode"`
	LockerID    string `json:"lockerId"`
	LunchPasses int    `json:"lunchPasses"`
}

func toSessionDTO(s Session) SessionDTO {
	return SessionDTO{
		ID:                s.ID,
		EventID:           s.EventID,
		VehicleID:         s.VehicleID,
		Status:            string(s.Status),
		CurrentWaypointID: s.CurrentWaypointID,
		TotalScore:        s.TotalScore,
		BoundAt:           formatTime(s.BoundAt),
		StartedAt:         formatTime(s.StartedAt),
		FinishedAt:        formatTime(s.FinishedAt),
		LastLat:           s.LastLat,
		LastLng:           s.LastLng,
	}
}

func toCircleDTO(c GeoCircle) CircleDTO {
	return CircleDTO{Lat: c.Lat, Lng: c.Lng, RadiusM: c.RadiusM, Placed: c.Placed}
}

func toWaypointDTOs(list []WaypointGeo) []WaypointDTO {
	out := make([]WaypointDTO, 0, len(list))
	for _, w := range list {
		taskIDs := make([]string, 0, len(w.Tasks))
		for _, task := range w.Tasks {
			taskIDs = append(taskIDs, task.ID)
		}
		out = append(out, WaypointDTO{
			ID:      w.ID,
			Order:   w.Order,
			Circle:  toCircleDTO(w.Circle),
			TaskIDs: taskIDs,
		})
	}

	return out
}

// toDeviceDTO resolves Sharing against now, so every phone reading the same
// response sees the same answer rather than each judging staleness itself.
func toDeviceDTO(device Device, now time.Time) DeviceDTO {
	return DeviceDTO{
		ID:             device.ID,
		CrewMemberID:   device.CrewMemberID,
		CrewMemberName: device.CrewMemberName,
		JoinedAt:       device.JoinedAt.UTC().Format(time.RFC3339),
		LastSeenAt:     formatTime(device.LastSeenAt),
		Sharing:        device.IsSharing(now),
	}
}

func toDeviceDTOs(devices []Device, now time.Time) []DeviceDTO {
	out := make([]DeviceDTO, 0, len(devices))
	for _, device := range devices {
		out = append(out, toDeviceDTO(device, now))
	}

	return out
}

func sharingCount(devices []DeviceDTO) int {
	count := 0
	for _, device := range devices {
		if device.Sharing {
			count++
		}
	}

	return count
}

func toStateDTO(state SessionState, now time.Time) SessionStateDTO {
	crew := toDeviceDTOs(state.Crew, now)

	return SessionStateDTO{
		Session:        toSessionDTO(state.Session),
		VehicleCode:    state.VehicleCode,
		TeamName:       state.TeamName,
		EventStatus:    state.EventStatus,
		StartTime:      state.StartTime,
		Cipher:         state.Cipher,
		StartCircle:    toCircleDTO(state.StartCircle),
		FinishCircle:   toCircleDTO(state.FinishCircle),
		Waypoints:      toWaypointDTOs(state.Waypoints),
		NextWaypointID: state.NextWaypointID,
		Crew:           crew,
		You:            toDeviceDTO(state.You, now),
		SharingCount:   sharingCount(crew),
	}
}

func toJoinResponse(result JoinResult, now time.Time) JoinResponse {
	return JoinResponse{
		TeamToken: result.Token,
		Session:   toSessionDTO(result.Session),
		Device:    toDeviceDTO(result.Device, now),
		Crew:      toDeviceDTOs(result.Crew, now),
	}
}

func toPingResponse(result PingResult) PingResponse {
	unlocked := result.UnlockedTaskIDs
	if unlocked == nil {
		unlocked = []string{}
	}
	events := make([]PingEventDTO, 0, len(result.Events))
	for _, e := range result.Events {
		events = append(events, PingEventDTO{
			Type:       string(e.Type),
			WaypointID: e.WaypointID,
			TaskID:     e.TaskID,
		})
	}

	return PingResponse{
		UnlockedTaskIDs:   unlocked,
		CurrentWaypointID: result.CurrentWaypointID,
		Arrived:           result.Arrived,
		Events:            events,
	}
}

func toTaskStateDTOs(list []TaskState) []TaskStateDTO {
	out := make([]TaskStateDTO, 0, len(list))
	for _, state := range list {
		out = append(out, TaskStateDTO{
			CompletedBy: state.CompletedBy,
			TaskID:      state.TaskID,
			WaypointID:  state.WaypointID,
			Code:        state.Code,
			Title:       state.Title,
			Type:        state.Type,
			Points:      state.Points,
			Status:      state.Status,
			Awarded:     state.Awarded,
		})
	}

	return out
}

func toVoucherDTO(v Voucher) VoucherDTO {
	return VoucherDTO{EntryCode: v.EntryCode, LockerID: v.LockerID, LunchPasses: v.LunchPasses}
}

func formatTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	formatted := t.UTC().Format(time.RFC3339)

	return &formatted
}
