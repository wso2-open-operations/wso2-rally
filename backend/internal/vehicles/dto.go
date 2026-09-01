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

package vehicles

// CrewMemberDTO is a crew member on the wire.
type CrewMemberDTO struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	PhoneNumber   string `json:"phoneNumber"`
	Role          string `json:"role"`
	OriginCountry string `json:"originCountry"`
}

// VehicleDTO is a vehicle with its crew on the wire.
type VehicleDTO struct {
	ID            string          `json:"id"`
	EventID       string          `json:"eventId"`
	Code          string          `json:"code"`
	TeamName      string          `json:"teamName"`
	VehicleType   string          `json:"vehicleType"`
	ContactNumber string          `json:"contactNumber"`
	RouteID       string          `json:"routeId"`
	Status        string          `json:"status"`
	Crew          []CrewMemberDTO `json:"crew"`
}

// CrewMemberRequest is one crew member on a create or update body.
type CrewMemberRequest struct {
	Name          string `json:"name"`
	PhoneNumber   string `json:"phoneNumber"`
	Role          string `json:"role"`
	OriginCountry string `json:"originCountry"`
}

// CreateVehicleRequest is the POST /events/{eventId}/vehicles body.
type CreateVehicleRequest struct {
	Code          string              `json:"code"`
	TeamName      string              `json:"teamName"`
	VehicleType   string              `json:"vehicleType"`
	ContactNumber string              `json:"contactNumber"`
	RouteID       string              `json:"routeId"`
	Crew          []CrewMemberRequest `json:"crew"`
}

// UpdateVehicleRequest is the PATCH /vehicles/{vehicleId} body. A non-nil crew
// replaces the whole list.
type UpdateVehicleRequest struct {
	Code          *string              `json:"code"`
	TeamName      *string              `json:"teamName"`
	VehicleType   *string              `json:"vehicleType"`
	ContactNumber *string              `json:"contactNumber"`
	RouteID       *string              `json:"routeId"`
	Status        *string              `json:"status"`
	Crew          *[]CrewMemberRequest `json:"crew"`
}

// SearchVehiclesRequest is the POST /events/{eventId}/vehicles/search body.
type SearchVehiclesRequest struct {
	Offset  int `json:"offset"`
	Limit   int `json:"limit"`
	Filters struct {
		// Query matches the vehicle code or the team name.
		Query string `json:"query"`
		// RouteID restricts the result to one course.
		RouteID string `json:"routeId"`
	} `json:"filters"`
}

func (r SearchVehiclesRequest) toFilter() SearchFilter {
	return SearchFilter{Query: r.Filters.Query, RouteID: r.Filters.RouteID}
}

// ImportResultDTO reports how many vehicles a CSV upload provisioned.
type ImportResultDTO struct {
	Imported int `json:"imported"`
}

func toDTO(v Vehicle) VehicleDTO {
	crew := make([]CrewMemberDTO, 0, len(v.Crew))
	for _, member := range v.Crew {
		crew = append(crew, CrewMemberDTO{
			ID:            member.ID,
			Name:          member.Name,
			PhoneNumber:   member.PhoneNumber,
			Role:          string(member.Role),
			OriginCountry: member.OriginCountry,
		})
	}

	return VehicleDTO{
		ID:            v.ID,
		EventID:       v.EventID,
		Code:          v.Code,
		TeamName:      v.TeamName,
		VehicleType:   v.VehicleType,
		ContactNumber: v.ContactNumber,
		RouteID:       v.RouteID,
		Status:        string(v.Status),
		Crew:          crew,
	}
}

func toDTOs(list []Vehicle) []VehicleDTO {
	out := make([]VehicleDTO, 0, len(list))
	for _, v := range list {
		out = append(out, toDTO(v))
	}

	return out
}

func toCrewInputs(requests []CrewMemberRequest) []CrewMemberInput {
	out := make([]CrewMemberInput, 0, len(requests))
	for _, req := range requests {
		out = append(out, CrewMemberInput{
			Name:          req.Name,
			PhoneNumber:   req.PhoneNumber,
			Role:          CrewRole(req.Role),
			OriginCountry: req.OriginCountry,
		})
	}

	return out
}

func (r CreateVehicleRequest) toCreateInput(eventID string) CreateVehicleInput {
	return CreateVehicleInput{
		EventID:       eventID,
		Code:          r.Code,
		TeamName:      r.TeamName,
		VehicleType:   r.VehicleType,
		ContactNumber: r.ContactNumber,
		RouteID:       r.RouteID,
		Crew:          toCrewInputs(r.Crew),
	}
}

func (r UpdateVehicleRequest) toUpdateInput() UpdateVehicleInput {
	in := UpdateVehicleInput{
		Code:          r.Code,
		TeamName:      r.TeamName,
		VehicleType:   r.VehicleType,
		ContactNumber: r.ContactNumber,
		RouteID:       r.RouteID,
	}
	if r.Status != nil {
		status := Status(*r.Status)
		in.Status = &status
	}
	if r.Crew != nil {
		crew := toCrewInputs(*r.Crew)
		in.Crew = &crew
	}

	return in
}
