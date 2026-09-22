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

package main

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/config"
)

func TestMaySubscribe(t *testing.T) {
	cfg := config.Config{OrganizerRole: "rally-organizer", AdminRole: "rally-admin"}
	organizer := authz.Identity{Kind: authz.KindOrganizer, UserID: "u1", Groups: []string{"rally-organizer"}}
	admin := authz.Identity{Kind: authz.KindOrganizer, UserID: "u2", Groups: []string{"rally-admin"}}
	// A crew member's phone holds a perfectly valid Asgardeo token too, so it
	// resolves to KindOrganizer exactly like staff — kind alone cannot be what
	// keeps them off another car's session or another event's monitor.
	crewWithOrganizerKindToken := authz.Identity{Kind: authz.KindOrganizer, UserID: "u3"}
	crew := authz.Identity{Kind: authz.KindTeam, SessionID: "sess-1"}

	tests := []struct {
		name     string
		identity authz.Identity
		topic    string
		want     bool
	}{
		{"organizer watches an event", organizer, "event:e1", true},
		{"organizer watches a session", organizer, "session:sess-1", true},
		{"admin watches an event", admin, "event:e1", true},
		{"organizer with an unknown topic", organizer, "everything", false},
		{"organizer-kind token with no organizer group is refused", crewWithOrganizerKindToken, "event:e1", false},
		{"organizer-kind token with no organizer group cannot snoop a session either", crewWithOrganizerKindToken, "session:sess-1", false},
		{"crew watches its own session", crew, "session:sess-1", true},
		// The other crew's topic carries their cipher and their position.
		{"crew watches another session", crew, "session:sess-2", false},
		{"crew watches the whole event", crew, "event:e1", false},
		{"crew with an empty topic", crew, "", false},
		{"unauthenticated", authz.Identity{}, "event:e1", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, maySubscribe(tt.identity, tt.topic, cfg))
		})
	}
}

func TestOriginHostOf(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"http://localhost:3000", "localhost:3000"},
		{"https://rally.wso2.com", "rally.wso2.com"},
		{"", ""},
		{"not a url", ""},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			require.Equal(t, tt.want, originHostOf(tt.in))
		})
	}
}

func TestIsScoreDelta(t *testing.T) {
	require.True(t, isScoreDelta(map[string]any{"type": "score_delta"}))
	require.False(t, isScoreDelta(map[string]any{"type": "vehicle_position"}))
	require.False(t, isScoreDelta("score_delta"))
	require.False(t, isScoreDelta(nil))
}
