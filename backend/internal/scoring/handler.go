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

package scoring

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
)

// LeaderboardEntryDTO is one row of the pavilion leaderboard.
type LeaderboardEntryDTO struct {
	Rank        int     `json:"rank"`
	VehicleCode string  `json:"vehicleCode"`
	TeamName    string  `json:"teamName"`
	TotalScore  int     `json:"totalScore"`
	FinishTime  *string `json:"finishTime"`
}

// VehicleProgressDTO is one row of the live monitor.
type VehicleProgressDTO struct {
	VehicleCode   string   `json:"vehicleCode"`
	TeamName      string   `json:"teamName"`
	Status        string   `json:"status"`
	SessionStatus string   `json:"sessionStatus"`
	Done          int      `json:"done"`
	TotalTasks    int      `json:"totalTasks"`
	TotalScore    int      `json:"totalScore"`
	LastLat       *float64 `json:"lastLat"`
	LastLng       *float64 `json:"lastLng"`
	LastSeenAt    *string  `json:"lastSeenAt"`
	LastReportAt  *string  `json:"lastReportAt"`
	// CoverageLost flags a car on the course with no phone sharing location.
	CoverageLost bool `json:"coverageLost"`
}

// MonitorSnapshotDTO is the whole live-monitor payload.
type MonitorSnapshotDTO struct {
	Vehicles   []VehicleProgressDTO `json:"vehicles"`
	OpenAlerts int                  `json:"openAlerts"`
}

// Handler exposes the organizer read views.
type Handler struct {
	service *Service
	logger  *slog.Logger
}

// NewHandler wires a Handler to its service.
func NewHandler(service *Service, logger *slog.Logger) *Handler {
	return &Handler{service: service, logger: logger}
}

// Register adds the leaderboard and monitor endpoints to r.
func (h *Handler) Register(r chi.Router) {
	r.Get("/events/{eventId}/leaderboard", h.leaderboard)
	r.Get("/events/{eventId}/monitor", h.monitor)
}

func (h *Handler) leaderboard(w http.ResponseWriter, r *http.Request) {
	entries, err := h.service.Leaderboard(r.Context(), chi.URLParam(r, "eventId"))
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toLeaderboardDTOs(entries))
}

func (h *Handler) monitor(w http.ResponseWriter, r *http.Request) {
	snapshot, err := h.service.MonitorSnapshot(r.Context(), chi.URLParam(r, "eventId"))
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, MonitorSnapshotDTO{
		Vehicles:   toProgressDTOs(snapshot.Vehicles),
		OpenAlerts: snapshot.OpenAlerts,
	})
}

func toLeaderboardDTOs(entries []LeaderboardEntry) []LeaderboardEntryDTO {
	out := make([]LeaderboardEntryDTO, 0, len(entries))
	for _, entry := range entries {
		out = append(out, LeaderboardEntryDTO{
			Rank:        entry.Rank,
			VehicleCode: entry.VehicleCode,
			TeamName:    entry.TeamName,
			TotalScore:  entry.TotalScore,
			FinishTime:  formatTime(entry.FinishTime),
		})
	}

	return out
}

func toProgressDTOs(list []VehicleProgress) []VehicleProgressDTO {
	out := make([]VehicleProgressDTO, 0, len(list))
	for _, row := range list {
		out = append(out, VehicleProgressDTO{
			VehicleCode:   row.VehicleCode,
			TeamName:      row.TeamName,
			Status:        row.Status,
			SessionStatus: row.SessionStatus,
			Done:          row.Done,
			TotalTasks:    row.TotalTasks,
			TotalScore:    row.TotalScore,
			LastLat:       row.LastLat,
			LastLng:       row.LastLng,
			LastSeenAt:    formatTime(row.LastSeenAt),
			LastReportAt:  formatTime(row.LastReportAt),
			CoverageLost:  row.CoverageLost,
		})
	}

	return out
}

func formatTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	formatted := t.UTC().Format(time.RFC3339)

	return &formatted
}
