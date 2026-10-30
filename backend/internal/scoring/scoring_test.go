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
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/sessions"
)

const eventID = "0123456789abcdef0123456789abcdef"

var (
	noon      = time.Date(2027, 2, 13, 12, 0, 0, 0, time.UTC)
	oneOClock = noon.Add(time.Hour)
)

type fakeRepo struct {
	standings  []Standing
	progress   []VehicleProgress
	openAlerts int
	err        error
	// eventDate and eventStartTime are the event's wall-clock start.
	eventDate      string
	eventStartTime string
	startErr       error
}

// newService reads event starts in UTC, so a test's "09:00" is 09:00 UTC.
func newService(repo *fakeRepo) *Service { return NewService(repo, time.UTC) }

func (f *fakeRepo) EventStartOf(context.Context, string) (string, string, error) {
	return f.eventDate, f.eventStartTime, f.startErr
}

func (f *fakeRepo) StandingsOf(context.Context, string) ([]Standing, error) {
	return f.standings, f.err
}

func (f *fakeRepo) ProgressOf(context.Context, string) ([]VehicleProgress, error) {
	return f.progress, f.err
}

func (f *fakeRepo) OpenAlertCountOf(context.Context, string) (int, error) {
	return f.openAlerts, f.err
}

func at(t time.Time) *time.Time { return &t }

func codesOf(entries []LeaderboardEntry) []string {
	codes := make([]string, 0, len(entries))
	for _, entry := range entries {
		codes = append(codes, entry.VehicleCode)
	}

	return codes
}

func ranksOf(entries []LeaderboardEntry) []int {
	ranks := make([]int, 0, len(entries))
	for _, entry := range entries {
		ranks = append(ranks, entry.Rank)
	}

	return ranks
}

func TestRank_OrdersByScoreThenFinishTime(t *testing.T) {
	standings := []Standing{
		{VehicleCode: "PKT-003", TotalScore: 300, FinishTime: at(oneOClock)},
		{VehicleCode: "PKT-001", TotalScore: 500, FinishTime: at(oneOClock)},
		{VehicleCode: "PKT-002", TotalScore: 300, FinishTime: at(noon)},
	}

	got := Rank(standings)

	require.Equal(t, []string{"PKT-001", "PKT-002", "PKT-003"}, codesOf(got))
	require.Equal(t, []int{1, 2, 3}, ranksOf(got))
}

// A team still on the road cannot outrank one that has already crossed the
// line on the same score.
func TestRank_FinishedTeamBeatsARunningOne(t *testing.T) {
	standings := []Standing{
		{VehicleCode: "PKT-running", TotalScore: 300},
		{VehicleCode: "PKT-finished", TotalScore: 300, FinishTime: at(noon)},
	}

	got := Rank(standings)

	require.Equal(t, []string{"PKT-finished", "PKT-running"}, codesOf(got))
}

func TestRank_InseparableTeamsShareARank(t *testing.T) {
	standings := []Standing{
		{VehicleCode: "PKT-001", TotalScore: 300, FinishTime: at(noon)},
		{VehicleCode: "PKT-002", TotalScore: 300, FinishTime: at(noon)},
		{VehicleCode: "PKT-003", TotalScore: 100, FinishTime: at(noon)},
	}

	got := Rank(standings)

	require.Equal(t, []int{1, 1, 3}, ranksOf(got), "the rank after a tie skips the shared slot")
}

func TestRank_TeamsYetToScore(t *testing.T) {
	standings := []Standing{
		{VehicleCode: "PKT-001"},
		{VehicleCode: "PKT-002"},
	}

	got := Rank(standings)

	require.Equal(t, []int{1, 1}, ranksOf(got))
}

func TestRank_EmptyField(t *testing.T) {
	require.Empty(t, Rank(nil))
}

// Ranking must not reorder the caller's slice.
func TestRank_DoesNotMutateItsInput(t *testing.T) {
	standings := []Standing{
		{VehicleCode: "PKT-002", TotalScore: 100},
		{VehicleCode: "PKT-001", TotalScore: 500},
	}

	Rank(standings)

	require.Equal(t, "PKT-002", standings[0].VehicleCode)
}

func TestService_Leaderboard(t *testing.T) {
	svc := newService(&fakeRepo{standings: []Standing{
		{VehicleCode: "PKT-002", TotalScore: 100},
		{VehicleCode: "PKT-001", TotalScore: 500},
	}})

	got, err := svc.Leaderboard(context.Background(), eventID)

	require.NoError(t, err)
	require.Equal(t, []string{"PKT-001", "PKT-002"}, codesOf(got))
}

func TestService_Leaderboard_RequiresEventID(t *testing.T) {
	_, err := newService(&fakeRepo{}).Leaderboard(context.Background(), "")

	require.ErrorIs(t, err, apperr.ErrValidation)
}

func TestService_Leaderboard_PropagatesRepoFailure(t *testing.T) {
	_, err := newService(&fakeRepo{err: errors.New("db down")}).Leaderboard(context.Background(), eventID)

	require.ErrorContains(t, err, "db down")
}

func TestService_MonitorSnapshot(t *testing.T) {
	svc := newService(&fakeRepo{
		eventDate:      "2027-02-13",
		eventStartTime: "09:00",
		progress: []VehicleProgress{
			{VehicleCode: "PKT-001", Status: "ok", SessionStatus: "active", Done: 3, TotalTasks: 15},
			{VehicleCode: "PKT-002", Status: "breakdown", SessionStatus: ""},
		},
		openAlerts: 2,
	})

	got, err := svc.MonitorSnapshot(context.Background(), eventID)

	require.NoError(t, err)
	require.Len(t, got.Vehicles, 2)
	require.Equal(t, 2, got.OpenAlerts)
	require.Equal(t, 3, got.Vehicles[0].Done)
	require.Empty(t, got.Vehicles[1].SessionStatus, "an unbound vehicle still appears on the monitor")
}

func TestService_MonitorSnapshot_RequiresEventID(t *testing.T) {
	_, err := newService(&fakeRepo{}).MonitorSnapshot(context.Background(), "")

	require.ErrorIs(t, err, apperr.ErrValidation)
}

// A monitor opened mid-rally must show a dark car straight away, not wait for
// the next coverage_lost frame — which, for a car already dark, never comes.
func TestService_MonitorSnapshot_FlagsCarsWithNoPhoneSharing(t *testing.T) {
	now := time.Date(2027, 2, 13, 10, 0, 0, 0, time.UTC)
	reported := func(ago time.Duration) *time.Time {
		at := now.Add(-ago)
		return &at
	}
	svc := newService(&fakeRepo{eventDate: "2027-02-13", eventStartTime: "09:00", progress: []VehicleProgress{
		{VehicleCode: "LIVE", SessionStatus: "active", LastReportAt: reported(5 * time.Second)},
		{VehicleCode: "DARK", SessionStatus: "active", LastReportAt: reported(45 * time.Second)},
		{VehicleCode: "NEVER", SessionStatus: "active"},
		// Only a car on the course can go dark. One still on the grid, or one
		// that has finished, is not expected to be reporting.
		{VehicleCode: "GRID", SessionStatus: "bound", LastReportAt: reported(time.Hour)},
		{VehicleCode: "DONE", SessionStatus: "finished", LastReportAt: reported(time.Hour)},
	}})
	svc.now = func() time.Time { return now }

	got, err := svc.MonitorSnapshot(context.Background(), eventID)

	require.NoError(t, err)
	flagged := map[string]bool{}
	for _, vehicle := range got.Vehicles {
		flagged[vehicle.VehicleCode] = vehicle.CoverageLost
	}
	require.Equal(t, map[string]bool{
		"LIVE": false, "DARK": true, "NEVER": true, "GRID": false, "DONE": false,
	}, flagged)
}

// A session turns active on its first ping, which can come from the grid long
// before the start. The monitor agrees with the coverage frames: a crew that
// locked its phones on the grid is not dark until the rally starts without it.
func TestService_MonitorSnapshot_CountsSilenceFromTheStart(t *testing.T) {
	nineAM := time.Date(2027, 2, 13, 9, 0, 0, 0, time.UTC)
	onTheGrid := nineAM.Add(-30 * time.Minute)
	svc := newService(&fakeRepo{eventDate: "2027-02-13", eventStartTime: "09:00", progress: []VehicleProgress{
		{VehicleCode: "QUIET", SessionStatus: "active", LastReportAt: &onTheGrid},
		{VehicleCode: "NEVER", SessionStatus: "active"},
	}})
	flaggedAt := func(now time.Time) map[string]bool {
		svc.now = func() time.Time { return now }
		got, err := svc.MonitorSnapshot(context.Background(), eventID)
		require.NoError(t, err)
		flagged := map[string]bool{}
		for _, vehicle := range got.Vehicles {
			flagged[vehicle.VehicleCode] = vehicle.CoverageLost
		}
		return flagged
	}

	require.Equal(t, map[string]bool{"QUIET": false, "NEVER": false}, flaggedAt(nineAM.Add(-time.Minute)))
	require.Equal(t, map[string]bool{"QUIET": false, "NEVER": false},
		flaggedAt(nineAM.Add(sessions.CoverageAlarmAfter)))
	require.Equal(t, map[string]bool{"QUIET": true, "NEVER": true},
		flaggedAt(nineAM.Add(sessions.CoverageAlarmAfter+time.Second)))
}

// A start that cannot be read is a guard that cannot judge: each car is judged
// by its last report alone, and flagged rather than assumed covered.
func TestService_MonitorSnapshot_AnUnreadableStartJudgesByReportsAlone(t *testing.T) {
	now := time.Date(2027, 2, 13, 10, 0, 0, 0, time.UTC)
	lastHeard := now.Add(-45 * time.Second)
	svc := newService(&fakeRepo{eventDate: "2027-02-13", eventStartTime: "whenever", progress: []VehicleProgress{
		{VehicleCode: "DARK", SessionStatus: "active", LastReportAt: &lastHeard},
	}})
	svc.now = func() time.Time { return now }

	got, err := svc.MonitorSnapshot(context.Background(), eventID)

	require.NoError(t, err)
	require.True(t, got.Vehicles[0].CoverageLost)
}

func TestService_MonitorSnapshot_PropagatesAStartLookupFailure(t *testing.T) {
	svc := newService(&fakeRepo{startErr: errors.New("db down"), progress: []VehicleProgress{
		{VehicleCode: "PKT-001", SessionStatus: "active"},
	}})

	_, err := svc.MonitorSnapshot(context.Background(), eventID)

	require.ErrorContains(t, err, "db down")
}

// With no car on the course there is no coverage to judge, so the start is not
// looked up — and a monitor opened before the rally cannot fail on it.
func TestService_MonitorSnapshot_NoStartLookupWithNobodyOnTheCourse(t *testing.T) {
	svc := newService(&fakeRepo{startErr: errors.New("db down"), progress: []VehicleProgress{
		{VehicleCode: "PKT-001", SessionStatus: "bound"},
	}})

	_, err := svc.MonitorSnapshot(context.Background(), eventID)

	require.NoError(t, err)
}
