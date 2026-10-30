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
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package sessions

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

var coverageNow = time.Date(2027, 2, 13, 10, 0, 0, 0, time.UTC)

func ago(d time.Duration) *time.Time {
	at := coverageNow.Add(-d)
	return &at
}

func TestCoverageLost(t *testing.T) {
	started := coverageNow.Add(-time.Hour)
	tests := map[string]struct {
		lastReport *time.Time
		startsAt   time.Time
		want       bool
	}{
		"reported just now":            {ago(0), started, false},
		"reported at the threshold":    {ago(CoverageAlarmAfter), started, false},
		"silent past the threshold":    {ago(CoverageAlarmAfter + time.Second), started, true},
		"never reported — cannot tell": {nil, started, true},
		// A crew waiting on the grid may lock its phones. Nobody is expected to
		// report before the start, so the silence is counted from it.
		"silent on the grid before the start": {ago(time.Hour), coverageNow.Add(time.Minute), false},
		"silent since the grid, start just passed": {
			ago(time.Hour), coverageNow.Add(-CoverageAlarmAfter), false,
		},
		"silent since the grid, past the threshold": {
			ago(time.Hour), coverageNow.Add(-CoverageAlarmAfter - time.Second), true,
		},
		"never reported, start just passed": {nil, coverageNow.Add(-time.Second), false},
		// A start that cannot be read is the zero instant: the car is judged by
		// its last report alone, and warned about rather than assumed covered.
		"start unknown, silent past the threshold": {ago(CoverageAlarmAfter + time.Second), time.Time{}, true},
		"start unknown, never reported":            {nil, time.Time{}, true},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, tt.want, CoverageLost(tt.lastReport, tt.startsAt, coverageNow))
		})
	}
}

// A session turns active on its first ping, which can come from the grid long
// before 09:00. A crew that then locks its phones has not gone dark — until the
// rally starts without them reporting.
func TestService_CheckCoverage_QuietOnTheGridBeforeTheStart(t *testing.T) {
	svc, repo, _, sent := newService(t)
	startingRally(repo)
	onTheGrid := nineAM.Add(-30 * time.Minute)
	repo.coverage = []SessionCoverage{{
		SessionID: "session-a", EventID: testEventID, VehicleCode: "PKT-001", LastReportAt: &onTheGrid,
	}}

	frozenClock(svc, nineAM.Add(-time.Minute))
	require.NoError(t, svc.CheckCoverage(context.Background()))
	require.Empty(t, *sent, "before the start")

	frozenClock(svc, nineAM.Add(CoverageAlarmAfter))
	require.NoError(t, svc.CheckCoverage(context.Background()))
	require.Empty(t, *sent, "the crew gets the same 30 s from the start as anyone between reports")

	frozenClock(svc, nineAM.Add(CoverageAlarmAfter+time.Second))
	require.NoError(t, svc.CheckCoverage(context.Background()))
	require.Len(t, messagesOfType(*sent, "coverage_lost"), 2)
}

func TestService_CheckCoverage_ReportsAnEventLookupFailure(t *testing.T) {
	svc, repo, _, sent := newService(t)
	onCourse(repo, 45*time.Second)
	repo.activeEventsErr = errors.New("db down")
	frozenClock(svc, coverageNow)

	require.Error(t, svc.CheckCoverage(context.Background()))
	require.Empty(t, *sent)
}

// onCourse is one car out on the route, last heard from `silent` ago.
func onCourse(repo *fakeRepo, silent time.Duration) {
	repo.coverage = []SessionCoverage{{
		SessionID: "session-a", EventID: testEventID, VehicleCode: "PKT-001", LastReportAt: ago(silent),
	}}
}

func TestService_CheckCoverage_QuietWhileSomeoneIsSharing(t *testing.T) {
	svc, repo, _, sent := newService(t)
	onCourse(repo, 10*time.Second)
	frozenClock(svc, coverageNow)

	require.NoError(t, svc.CheckCoverage(context.Background()))

	require.Empty(t, *sent)
}

// The driver is in Google Maps and nobody else is reporting. Every open phone in
// the car is told, and so is the organizer, whose monitor flags the car.
func TestService_CheckCoverage_AnnouncesWhenNobodyIsSharing(t *testing.T) {
	svc, repo, _, sent := newService(t)
	onCourse(repo, 45*time.Second)
	frozenClock(svc, coverageNow)

	require.NoError(t, svc.CheckCoverage(context.Background()))

	lost := messagesOfType(*sent, "coverage_lost")
	require.Len(t, lost, 2)
	require.Equal(t, SessionTopic("session-a"), lost[0].topic)
	require.Equal(t, EventTopic(testEventID), lost[1].topic)
	toOrganizer := lost[1].message.(map[string]any)
	require.Equal(t, "PKT-001", toOrganizer["vehicleCode"])
	require.Equal(t, coverageNow.Add(-45*time.Second).Format(time.RFC3339), toOrganizer["lastReportAt"])
}

// The check runs every second; a car that stays dark is announced once.
func TestService_CheckCoverage_AnnouncesOnce(t *testing.T) {
	svc, repo, _, sent := newService(t)
	onCourse(repo, 45*time.Second)
	frozenClock(svc, coverageNow)
	require.NoError(t, svc.CheckCoverage(context.Background()))
	first := len(*sent)

	require.NoError(t, svc.CheckCoverage(context.Background()))

	require.Len(t, *sent, first)
}

// Someone opened the rally app again: the warning clears on every phone and the
// flag clears on the monitor.
func TestService_CheckCoverage_AnnouncesTheRecovery(t *testing.T) {
	svc, repo, _, sent := newService(t)
	onCourse(repo, 45*time.Second)
	frozenClock(svc, coverageNow)
	require.NoError(t, svc.CheckCoverage(context.Background()))

	onCourse(repo, time.Second)
	require.NoError(t, svc.CheckCoverage(context.Background()))

	restored := messagesOfType(*sent, "coverage_restored")
	require.Len(t, restored, 2)
	require.Equal(t, SessionTopic("session-a"), restored[0].topic)
	require.Equal(t, EventTopic(testEventID), restored[1].topic)
	require.Equal(t, "PKT-001", restored[1].message.(map[string]any)["vehicleCode"])
}

// A car that finishes while dark leaves the active list. Without a closing
// message its flag would stay up on the monitor for the rest of the day.
func TestService_CheckCoverage_ClearsTheFlagWhenTheRunEnds(t *testing.T) {
	svc, repo, _, sent := newService(t)
	onCourse(repo, 45*time.Second)
	frozenClock(svc, coverageNow)
	require.NoError(t, svc.CheckCoverage(context.Background()))

	repo.coverage = nil
	require.NoError(t, svc.CheckCoverage(context.Background()))

	restored := messagesOfType(*sent, "coverage_restored")
	require.Len(t, restored, 1)
	require.Equal(t, EventTopic(testEventID), restored[0].topic)
}

func TestService_CheckCoverage_ReportsARepoFailure(t *testing.T) {
	svc, repo, _, sent := newService(t)
	repo.coverageErr = errors.New("db down")

	require.Error(t, svc.CheckCoverage(context.Background()))
	require.Empty(t, *sent)
}

// A phone that opens mid-outage missed the coverage_lost frame, so the state it
// loads must carry the same answer — by the same 30 s rule, not the looser
// sharing window, or the banner would disagree with the frames for a minute.
func TestService_State_ReportsCoverageByTheAlarmRule(t *testing.T) {
	svc, repo, _, _ := newService(t)
	joined := joinAs(t, svc, crewAEmail)
	ctx := context.Background()
	stored := repo.sessions[joined.Session.ID]
	stored.Status = StatusActive
	repo.sessions[joined.Session.ID] = stored
	require.NoError(t, repo.TouchDevice(ctx, joined.Device.ID, coverageNow.Add(-45*time.Second)))

	frozenClock(svc, coverageNow)
	dark, err := svc.State(ctx, joined.Session.ID, joined.Device.ID)
	require.NoError(t, err)
	require.True(t, dark.CoverageLost, "45 s of silence is dark, though still inside the 90 s sharing window")

	require.NoError(t, repo.TouchDevice(ctx, joined.Device.ID, coverageNow))
	covered, err := svc.State(ctx, joined.Session.ID, joined.Device.ID)
	require.NoError(t, err)
	require.False(t, covered.CoverageLost)
}

// The state a phone loads agrees with the frames on the grid too: a crew that
// pinged before 09:00 and locked its phones is not dark until the rally starts.
func TestService_State_CountsSilenceFromTheStart(t *testing.T) {
	svc, repo, _, _ := newService(t)
	joined := joinAs(t, svc, crewAEmail)
	ctx := context.Background()
	stored := repo.sessions[joined.Session.ID]
	stored.Status = StatusActive
	repo.sessions[joined.Session.ID] = stored
	require.NoError(t, repo.TouchDevice(ctx, joined.Device.ID, nineAM.Add(-30*time.Minute)))

	frozenClock(svc, nineAM.Add(-time.Minute))
	early, err := svc.State(ctx, joined.Session.ID, joined.Device.ID)
	require.NoError(t, err)
	require.False(t, early.CoverageLost, "before the start")

	frozenClock(svc, nineAM.Add(CoverageAlarmAfter+time.Second))
	late, err := svc.State(ctx, joined.Session.ID, joined.Device.ID)
	require.NoError(t, err)
	require.True(t, late.CoverageLost)
}

// A crew still on the grid has not started reporting; that is not an outage.
func TestService_State_NoCoverageAlarmBeforeTheRunStarts(t *testing.T) {
	svc, _, _, _ := newService(t)
	joined := joinAs(t, svc, crewAEmail)
	frozenClock(svc, coverageNow)

	state, err := svc.State(context.Background(), joined.Session.ID, joined.Device.ID)

	require.NoError(t, err)
	require.False(t, state.CoverageLost)
}
