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

package events

import (
	"time"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
)

// dateLayout is the wire format for a calendar date, matching what the web app
// sends from its date picker.
const dateLayout = "2006-01-02"

// BoundaryDTO is a geofence on the wire.
type BoundaryDTO struct {
	Label   string   `json:"label"`
	Lat     *float64 `json:"lat"`
	Lng     *float64 `json:"lng"`
	RadiusM int      `json:"radiusM"`
}

// RouteRefDTO names one of the event's routes on the wire.
type RouteRefDTO struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// EventDTO is the event as clients see it: dates are strings, times are the
// literal wall-clock values the organizer entered.
type EventDTO struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	EventDate string      `json:"eventDate"`
	StartTime string      `json:"startTime"`
	Status    string      `json:"status"`
	Start     BoundaryDTO `json:"start"`
	End       BoundaryDTO `json:"end"`
	Cipher    string      `json:"cipher"`
	CreatedBy string      `json:"createdBy"`
	CreatedOn string      `json:"createdOn"`
	// Routes is always an array, never null, so the web app can map over it.
	Routes []RouteRefDTO `json:"routes"`
}

// StatsDTO carries the dashboard's headline counts.
type StatsDTO struct {
	Vehicles   int `json:"vehicles"`
	Crews      int `json:"crews"`
	Tasks      int `json:"tasks"`
	OpenAlerts int `json:"openAlerts"`
}

// CreateEventRequest is the POST /events body.
type CreateEventRequest struct {
	Name      string      `json:"name"`
	EventDate string      `json:"eventDate"`
	StartTime string      `json:"startTime"`
	Start     BoundaryDTO `json:"start"`
	End       BoundaryDTO `json:"end"`
	Cipher    string      `json:"cipher"`
}

// UpdateEventRequest is the PATCH /events/{id} body. Omitted fields are left
// unchanged, which is why every field is a pointer.
type UpdateEventRequest struct {
	Name      *string      `json:"name"`
	EventDate *string      `json:"eventDate"`
	StartTime *string      `json:"startTime"`
	Start     *BoundaryDTO `json:"start"`
	End       *BoundaryDTO `json:"end"`
	Cipher    *string      `json:"cipher"`
}

// SearchEventsRequest is the POST /events/search body.
type SearchEventsRequest struct {
	Offset  int `json:"offset"`
	Limit   int `json:"limit"`
	Filters struct {
		Status string `json:"status"`
	} `json:"filters"`
}

func toBoundaryDTO(b Boundary) BoundaryDTO {
	return BoundaryDTO{Label: b.Label, Lat: b.Lat, Lng: b.Lng, RadiusM: b.RadiusM}
}

func (d BoundaryDTO) toDomain() Boundary {
	return Boundary{Label: d.Label, Lat: d.Lat, Lng: d.Lng, RadiusM: d.RadiusM}
}

func toRouteRefDTOs(refs []RouteRef) []RouteRefDTO {
	out := make([]RouteRefDTO, 0, len(refs))
	for _, r := range refs {
		out = append(out, RouteRefDTO{ID: r.ID, Name: r.Name})
	}

	return out
}

func toStatsDTO(s Stats) StatsDTO {
	return StatsDTO{Vehicles: s.Vehicles, Crews: s.Crews, Tasks: s.Tasks, OpenAlerts: s.OpenAlerts}
}

func toDTO(e Event) EventDTO {
	return EventDTO{
		ID:        e.ID,
		Name:      e.Name,
		EventDate: e.EventDate.Format(dateLayout),
		StartTime: e.StartTime,
		Status:    string(e.Status),
		Start:     toBoundaryDTO(e.Start),
		End:       toBoundaryDTO(e.End),
		Cipher:    e.Cipher,
		CreatedBy: e.CreatedBy,
		CreatedOn: e.CreatedOn.UTC().Format(time.RFC3339),
		Routes:    toRouteRefDTOs(e.Routes),
	}
}

func toDTOs(list []Event) []EventDTO {
	out := make([]EventDTO, 0, len(list))
	for _, e := range list {
		out = append(out, toDTO(e))
	}

	return out
}

// toCreateInput converts the request into a validated service input. Date
// parsing is the only conversion that can fail here; the domain rules live in
// the service.
func (r CreateEventRequest) toCreateInput(createdBy string) (CreateEventInput, error) {
	eventDate, err := parseDate(r.EventDate)
	if err != nil {
		return CreateEventInput{}, err
	}

	return CreateEventInput{
		Name:      r.Name,
		EventDate: eventDate,
		StartTime: r.StartTime,
		Start:     r.Start.toDomain(),
		End:       r.End.toDomain(),
		Cipher:    r.Cipher,
		CreatedBy: createdBy,
	}, nil
}

func (r UpdateEventRequest) toUpdateInput() (UpdateEventInput, error) {
	in := UpdateEventInput{
		Name:      r.Name,
		StartTime: r.StartTime,
		Cipher:    r.Cipher,
	}
	if r.EventDate != nil {
		eventDate, err := parseDate(*r.EventDate)
		if err != nil {
			return UpdateEventInput{}, err
		}
		in.EventDate = &eventDate
	}
	if r.Start != nil {
		start := r.Start.toDomain()
		in.Start = &start
	}
	if r.End != nil {
		end := r.End.toDomain()
		in.End = &end
	}

	return in, nil
}

func (r SearchEventsRequest) toPageAndFilter() (httpx.Page, SearchFilter) {
	return httpx.NormalizePage(r.Offset, r.Limit), SearchFilter{Status: Status(r.Filters.Status)}
}

func parseDate(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, apperr.Validationf("event date is required")
	}
	parsed, err := time.Parse(dateLayout, value)
	if err != nil {
		return time.Time{}, apperr.Validationf("event date must be YYYY-MM-DD, got %q", value)
	}

	return parsed, nil
}
