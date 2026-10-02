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

// Package scoring turns stored submissions into the two read views organizers
// watch during a rally: the pavilion leaderboard and the live monitor.
//
// It owns no writes. Scores are set when a task is submitted; this package
// only ranks and summarises them.
package scoring

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/sessions"
)

// Standing is one team's raw position before ranking.
type Standing struct {
	VehicleCode string
	TeamName    string
	TotalScore  int
	// FinishTime is nil while the team is still running.
	FinishTime *time.Time
}

// LeaderboardEntry is a ranked standing, as shown on the pavilion screen.
type LeaderboardEntry struct {
	Rank int
	Standing
}

// VehicleProgress is one row of the live monitor.
type VehicleProgress struct {
	VehicleCode string
	TeamName    string
	// Status is the vehicle's health: ok, breakdown, or device_issue.
	Status string
	// SessionStatus is where its crew is in the run, or "" if unbound.
	SessionStatus string
	// Done counts the tasks the crew has completed, out of TotalTasks.
	Done       int
	TotalTasks int
	TotalScore int
	LastLat    *float64
	LastLng    *float64
	// LastSeenAt is when the car's last accepted fix was taken.
	LastSeenAt *time.Time
	// LastReportAt is when any phone in the car last reported, stamped on
	// arrival. It differs from LastSeenAt: a replayed buffer carries old fix
	// times, but the phone sending it is reporting now.
	LastReportAt *time.Time
	// CoverageLost is true for a car on the course with no phone sharing
	// location — the driver is in Google Maps and nobody else is reporting.
	CoverageLost bool
}

// MonitorSnapshot is the whole live-monitor view for one event.
type MonitorSnapshot struct {
	Vehicles []VehicleProgress
	// OpenAlerts is the count behind the dashboard's warning card.
	OpenAlerts int
}

// Repo is the read-side persistence contract.
type Repo interface {
	// StandingsOf returns every bound team's score, unranked.
	StandingsOf(ctx context.Context, eventID string) ([]Standing, error)
	// ProgressOf returns one row per vehicle in the event.
	ProgressOf(ctx context.Context, eventID string) ([]VehicleProgress, error)
	// OpenAlertCountOf counts the event's unresolved vehicle alerts.
	OpenAlertCountOf(ctx context.Context, eventID string) (int, error)
}

// Service exposes the two read views.
type Service struct {
	repo Repo
	// now is the clock coverage is judged by; a field so tests can pin it.
	now func() time.Time
}

// NewService wires a Service to its repository.
func NewService(repo Repo) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// Leaderboard ranks an event's teams.
func (s *Service) Leaderboard(ctx context.Context, eventID string) ([]LeaderboardEntry, error) {
	if eventID == "" {
		return nil, apperr.Validationf("event id is required")
	}

	standings, err := s.repo.StandingsOf(ctx, eventID)
	if err != nil {
		return nil, fmt.Errorf("load standings of event %s: %w", eventID, err)
	}

	return Rank(standings), nil
}

// MonitorSnapshot returns the live-monitor view: every vehicle's progress plus
// the open-alert count.
func (s *Service) MonitorSnapshot(ctx context.Context, eventID string) (MonitorSnapshot, error) {
	if eventID == "" {
		return MonitorSnapshot{}, apperr.Validationf("event id is required")
	}

	vehicles, err := s.repo.ProgressOf(ctx, eventID)
	if err != nil {
		return MonitorSnapshot{}, fmt.Errorf("load progress of event %s: %w", eventID, err)
	}
	openAlerts, err := s.repo.OpenAlertCountOf(ctx, eventID)
	if err != nil {
		return MonitorSnapshot{}, fmt.Errorf("count open alerts of event %s: %w", eventID, err)
	}

	// The same rule the live coverage_lost frames use, so a monitor opened on a
	// car that is already dark flags it immediately rather than never — that
	// car's frame went out before the page loaded. Only a car on the course is
	// expected to be reporting.
	now := s.now()
	for i := range vehicles {
		vehicles[i].CoverageLost = vehicles[i].SessionStatus == string(sessions.StatusActive) &&
			sessions.CoverageLost(vehicles[i].LastReportAt, now)
	}

	return MonitorSnapshot{Vehicles: vehicles, OpenAlerts: openAlerts}, nil
}

// Rank orders standings and assigns positions.
//
// Highest score wins; a tie is broken by who finished first, because a team
// that matched another's score in less time drove the better rally. A team
// still running loses a tie against one that has already finished. Teams that
// are genuinely inseparable — same score, same finish time — share a rank, and
// the next team's rank accounts for them.
//
// It is a pure function so the ordering can be tested without a database.
func Rank(standings []Standing) []LeaderboardEntry {
	sorted := slices.Clone(standings)
	slices.SortStableFunc(sorted, compareStandings)

	entries := make([]LeaderboardEntry, 0, len(sorted))
	for i, standing := range sorted {
		rank := i + 1
		// Competition ranking: equal teams share a position, and the position
		// after a tie skips the shared slots.
		if i > 0 && compareStandings(sorted[i-1], standing) == 0 {
			rank = entries[i-1].Rank
		}
		entries = append(entries, LeaderboardEntry{Rank: rank, Standing: standing})
	}

	return entries
}

// compareStandings orders two teams: better first.
func compareStandings(a, b Standing) int {
	if a.TotalScore != b.TotalScore {
		return b.TotalScore - a.TotalScore
	}

	switch {
	case a.FinishTime == nil && b.FinishTime == nil:
		return 0
	case a.FinishTime == nil:
		return 1 // Still running: behind anyone who has finished.
	case b.FinishTime == nil:
		return -1
	case a.FinishTime.Equal(*b.FinishTime):
		return 0
	case a.FinishTime.Before(*b.FinishTime):
		return -1
	default:
		return 1
	}
}
