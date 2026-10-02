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
	tests := map[string]struct {
		lastReport *time.Time
		want       bool
	}{
		"reported just now":            {ago(0), false},
		"reported at the threshold":    {ago(CoverageAlarmAfter), false},
		"silent past the threshold":    {ago(CoverageAlarmAfter + time.Second), true},
		"never reported — cannot tell": {nil, true},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			require.Equal(t, tt.want, CoverageLost(tt.lastReport, coverageNow))
		})
	}
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

// A crew still on the grid has not started reporting; that is not an outage.
func TestService_State_NoCoverageAlarmBeforeTheRunStarts(t *testing.T) {
	svc, _, _, _ := newService(t)
	joined := joinAs(t, svc, crewAEmail)
	frozenClock(svc, coverageNow)

	state, err := svc.State(context.Background(), joined.Session.ID, joined.Device.ID)

	require.NoError(t, err)
	require.False(t, state.CoverageLost)
}
