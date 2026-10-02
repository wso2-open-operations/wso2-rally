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
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/apperr"
)

// An absent ts is the live path and must stay exactly that: "now", decided by
// the server, with nothing parsed.
func TestLocationRequest_TakenAt_AbsentMeansNow(t *testing.T) {
	got, err := LocationRequest{Lat: 6.9, Lng: 79.9}.TakenAt()

	require.NoError(t, err)
	require.True(t, got.IsZero())
}

func TestLocationRequest_TakenAt_ParsesISO8601(t *testing.T) {
	tests := map[string]struct {
		ts   string
		want time.Time
	}{
		"UTC with millis": {"2027-02-13T09:28:00.250Z", time.Date(2027, 2, 13, 9, 28, 0, 250e6, time.UTC)},
		"an offset":       {"2027-02-13T14:58:00+05:30", time.Date(2027, 2, 13, 9, 28, 0, 0, time.UTC)},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			ts := tt.ts
			got, err := LocationRequest{Ts: &ts}.TakenAt()

			require.NoError(t, err)
			require.True(t, tt.want.Equal(got), "got %s", got)
		})
	}
}

// A timestamp that cannot be read is refused, not treated as "now": that would
// silently re-create the teleport the client sent it to avoid.
func TestLocationRequest_TakenAt_RejectsWhatItCannotRead(t *testing.T) {
	for _, ts := range []string{"", "yesterday", "2027-02-13 09:28:00", "1739438880"} {
		t.Run(ts, func(t *testing.T) {
			_, err := LocationRequest{Ts: &ts}.TakenAt()

			require.ErrorIs(t, err, apperr.ErrValidation)
		})
	}
}
