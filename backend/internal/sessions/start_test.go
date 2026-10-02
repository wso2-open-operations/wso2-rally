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

// colombo is the rally's wall clock. A fixed offset keeps the tests free of the
// host's tz database; production loads the named zone.
var colombo = time.FixedZone("Asia/Colombo", 5*60*60+30*60)

// nineAM is 09:00 on rally day in Colombo — 03:30 UTC.
var nineAM = time.Date(2027, 2, 13, 3, 30, 0, 0, time.UTC)

func TestStartInstant_ReadsTheWallClockInTheRallyZone(t *testing.T) {
	got, err := startInstant("2027-02-13", "09:00", colombo)

	require.NoError(t, err)
	require.True(t, nineAM.Equal(got), "got %s", got)
}

// A start that cannot be read cannot be judged, so it must not be treated as
// "already started" — that would leak the cipher.
func TestStartInstant_RejectsWhatItCannotRead(t *testing.T) {
	tests := map[string][2]string{
		"no date":     {"", "09:00"},
		"no time":     {"2027-02-13", ""},
		"seconds":     {"2027-02-13", "09:00:00"},
		"not a clock": {"2027-02-13", "nine"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := startInstant(tt[0], tt[1], colombo)

			require.Error(t, err)
		})
	}
}

// Publishing an event opens it to crews, which can be days before the rally.
// The cipher is part of the 09:00 start, so an active event alone must not
// reveal it.
func TestService_State_WithholdsTheCipherUntilTheStart(t *testing.T) {
	svc, _, _, _ := newService(t)
	session := bindOnce(t, svc)

	frozenClock(svc, nineAM.Add(-time.Minute))
	before, err := svc.State(context.Background(), session.ID, "")
	require.NoError(t, err)
	require.Empty(t, before.Cipher, "published, but not yet 09:00")
	require.True(t, nineAM.Equal(before.StartsAt), "the phone is told when to count down to")

	frozenClock(svc, nineAM)
	after, err := svc.State(context.Background(), session.ID, "")
	require.NoError(t, err)
	require.Equal(t, "API Integration", after.Cipher)
}

// A start time the service cannot read is a guard that cannot judge, so it
// denies: the cipher stays withheld rather than going out early.
func TestService_State_AnUnreadableStartWithholdsTheCipher(t *testing.T) {
	svc, repo, _, _ := newService(t)
	session := bindOnce(t, svc)
	repo.event.StartTime = "whenever"
	frozenClock(svc, nineAM.Add(24*time.Hour))

	state, err := svc.State(context.Background(), session.ID, "")

	require.NoError(t, err)
	require.Empty(t, state.Cipher)
	require.True(t, state.StartsAt.IsZero())
}

// messagesOfType returns every broadcast of one message type, in order.
func messagesOfType(sent []broadcastRecord, messageType string) []broadcastRecord {
	var out []broadcastRecord
	for _, record := range sent {
		if fields, ok := record.message.(map[string]any); ok && fields["type"] == messageType {
			out = append(out, record)
		}
	}
	return out
}

// startingRally is one active event with two cars on the grid.
func startingRally(repo *fakeRepo) {
	repo.activeEvents = []StartingEvent{
		{ID: testEventID, Date: "2027-02-13", StartTime: "09:00", Cipher: "API Integration"},
	}
	repo.liveSessionIDs = map[string][]string{testEventID: {"session-a", "session-b"}}
}

func TestService_FireDueStartSignals_NothingBeforeTheStart(t *testing.T) {
	svc, repo, _, sent := newService(t)
	startingRally(repo)
	frozenClock(svc, nineAM.Add(-time.Second))

	require.NoError(t, svc.FireDueStartSignals(context.Background()))

	require.Empty(t, *sent)
}

// Every bound phone releases at once: each live session gets the start and the
// cipher on its own topic.
func TestService_FireDueStartSignals_ReleasesEveryCarAtTheStart(t *testing.T) {
	svc, repo, _, sent := newService(t)
	startingRally(repo)
	frozenClock(svc, nineAM)

	require.NoError(t, svc.FireDueStartSignals(context.Background()))

	starts := messagesOfType(*sent, "start_signal")
	require.Len(t, starts, 2)
	require.Equal(t, SessionTopic("session-a"), starts[0].topic)
	require.Equal(t, SessionTopic("session-b"), starts[1].topic)
	require.Equal(t, time.Date(2027, 2, 13, 3, 30, 0, 0, time.UTC).Format(time.RFC3339),
		starts[0].message.(map[string]any)["startsAt"])

	ciphers := messagesOfType(*sent, "cipher_reveal")
	require.Len(t, ciphers, 2)
	require.Equal(t, "API Integration", ciphers[0].message.(map[string]any)["cipher"])
}

// The ticker runs every second; the start must fire once, not sixty times a
// minute.
func TestService_FireDueStartSignals_FiresOnce(t *testing.T) {
	svc, repo, _, sent := newService(t)
	startingRally(repo)
	frozenClock(svc, nineAM)
	require.NoError(t, svc.FireDueStartSignals(context.Background()))
	first := len(*sent)

	frozenClock(svc, nineAM.Add(2*time.Second))
	require.NoError(t, svc.FireDueStartSignals(context.Background()))

	require.Len(t, *sent, first)
}

// A server that comes up at noon must not announce a 09:00 start. Phones that
// missed the frame read the cipher from GET /sessions/me.
func TestService_FireDueStartSignals_NotLongAfterTheStart(t *testing.T) {
	svc, repo, _, sent := newService(t)
	startingRally(repo)
	frozenClock(svc, nineAM.Add(startSignalWindow+time.Second))

	require.NoError(t, svc.FireDueStartSignals(context.Background()))

	require.Empty(t, *sent)
}

// A failed lookup must not count as fired, or no car would ever be released.
func TestService_FireDueStartSignals_RetriesAfterAFailure(t *testing.T) {
	svc, repo, _, sent := newService(t)
	startingRally(repo)
	frozenClock(svc, nineAM)
	repo.liveSessionsErr = errors.New("db down")

	require.Error(t, svc.FireDueStartSignals(context.Background()))
	require.Empty(t, *sent)

	repo.liveSessionsErr = nil
	require.NoError(t, svc.FireDueStartSignals(context.Background()))
	require.Len(t, messagesOfType(*sent, "start_signal"), 2)
}

// An event with no cipher configured still starts; there is just nothing to
// reveal, and an empty reveal would blank the B3 screen.
func TestService_FireDueStartSignals_NoCipherStillStarts(t *testing.T) {
	svc, repo, _, sent := newService(t)
	startingRally(repo)
	repo.activeEvents[0].Cipher = ""
	frozenClock(svc, nineAM)

	require.NoError(t, svc.FireDueStartSignals(context.Background()))

	require.Len(t, messagesOfType(*sent, "start_signal"), 2)
	require.Empty(t, messagesOfType(*sent, "cipher_reveal"))
}

// One badly configured event must not hold back every other rally's start.
func TestService_FireDueStartSignals_OneBadEventDoesNotBlockTheRest(t *testing.T) {
	svc, repo, _, sent := newService(t)
	startingRally(repo)
	repo.activeEvents = append([]StartingEvent{
		{ID: "broken", Date: "2027-02-13", StartTime: "whenever"},
	}, repo.activeEvents...)
	frozenClock(svc, nineAM)

	err := svc.FireDueStartSignals(context.Background())

	require.Error(t, err, "the broken event is reported")
	require.Len(t, messagesOfType(*sent, "start_signal"), 2, "the good one still starts")
}
