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

package config

import (
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLoad_MissingRequired(t *testing.T) {
	t.Setenv("DB_DSN", "")
	t.Setenv("TEAM_TOKEN_SECRET", "")

	_, err := Load()

	require.Error(t, err)
	require.Contains(t, err.Error(), "DB_DSN")
	require.Contains(t, err.Error(), "TEAM_TOKEN_SECRET")
}

func TestLoad_DefaultsAndValues(t *testing.T) {
	t.Setenv("DB_DSN", "user:pass@tcp(localhost:3306)/rally")
	t.Setenv("TEAM_TOKEN_SECRET", "s3cret")
	// Now required: with the validator on by default there has to be something
	// to verify against.
	t.Setenv("JWKS_ENDPOINT", "https://example.test/jwks")

	c, err := Load()

	require.NoError(t, err)
	require.Equal(t, "8080", c.Port)
	require.Equal(t, "INFO", c.LogLevel)
	require.Equal(t, "user:pass@tcp(localhost:3306)/rally", c.DBDsn)
	require.Equal(t, "rally-admin", c.AdminRole)
	// Unset ORGANIZER_ROLE falls back to the admin group rather than to "no
	// group required": failing closed keeps the organizer surface shut on a
	// deployment that has not thought about it yet.
	require.Equal(t, c.AdminRole, c.OrganizerRole)
	require.Equal(t, 12*time.Hour, c.TeamTokenTTL)
	require.True(t, c.TokenValidatorEnabled)
}

func TestLoad_OrganizerRoleIsSeparableFromAdmin(t *testing.T) {
	t.Setenv("DB_DSN", "user:pass@tcp(localhost:3306)/rally")
	t.Setenv("TEAM_TOKEN_SECRET", "s3cret")
	t.Setenv("ADMIN_ROLE", "rally-admin")
	t.Setenv("ORGANIZER_ROLE", "rally-organizer")
	// Verification is on unless opted out, so Load needs somewhere to verify
	// against even when the test is only about role names.
	t.Setenv("JWKS_ENDPOINT", "https://example.test/jwks")

	c, err := Load()

	require.NoError(t, err)
	require.Equal(t, "rally-organizer", c.OrganizerRole)
	require.Equal(t, "rally-admin", c.AdminRole)
}

func TestLoad_TokenValidatorRequiresJWKS(t *testing.T) {
	t.Setenv("DB_DSN", "dsn")
	t.Setenv("TEAM_TOKEN_SECRET", "s3cret")
	t.Setenv("TOKEN_VALIDATOR_ENABLED", "true")
	t.Setenv("JWKS_ENDPOINT", "")

	_, err := Load()

	require.Error(t, err)
	require.Contains(t, err.Error(), "JWKS_ENDPOINT")
}

// An unset TOKEN_VALIDATOR_ENABLED must mean signatures ARE verified. The
// insecure path has to be opted into, never inherited from a forgotten
// variable: a deployment that omits it entirely would otherwise accept any
// forged token carrying groups: ["admin"] as an organizer admin.
func TestLoad_TokenValidatorDefaultsToEnabled(t *testing.T) {
	t.Setenv("DB_DSN", "dsn")
	t.Setenv("TEAM_TOKEN_SECRET", "s3cret")
	t.Setenv("JWKS_ENDPOINT", "https://example.test/jwks")
	t.Setenv("TOKEN_VALIDATOR_ENABLED", "")
	os.Unsetenv("TOKEN_VALIDATOR_ENABLED")

	c, err := Load()

	require.NoError(t, err)
	require.True(t, c.TokenValidatorEnabled)
}

// And with the flag unset, a missing JWKS endpoint must stop the server rather
// than silently degrade it to decode-only.
func TestLoad_UnsetValidatorStillRequiresJWKS(t *testing.T) {
	t.Setenv("DB_DSN", "dsn")
	t.Setenv("TEAM_TOKEN_SECRET", "s3cret")
	t.Setenv("JWKS_ENDPOINT", "")
	t.Setenv("TOKEN_VALIDATOR_ENABLED", "")
	os.Unsetenv("TOKEN_VALIDATOR_ENABLED")

	_, err := Load()

	require.Error(t, err)
	require.Contains(t, err.Error(), "JWKS_ENDPOINT")
}

// Turning verification off is still possible, but only by saying so.
func TestLoad_TokenValidatorExplicitOptOut(t *testing.T) {
	t.Setenv("DB_DSN", "dsn")
	t.Setenv("TEAM_TOKEN_SECRET", "s3cret")
	t.Setenv("TOKEN_VALIDATOR_ENABLED", "false")
	t.Setenv("JWKS_ENDPOINT", "")

	c, err := Load()

	require.NoError(t, err)
	require.False(t, c.TokenValidatorEnabled)
}

func TestLoad_InvalidTeamTokenTTL(t *testing.T) {
	t.Setenv("DB_DSN", "dsn")
	t.Setenv("TEAM_TOKEN_SECRET", "s3cret")
	t.Setenv("TEAM_TOKEN_TTL", "not-a-duration")

	_, err := Load()

	require.Error(t, err)
	require.Contains(t, err.Error(), "TEAM_TOKEN_TTL")
}

func TestLogLevel_ParsesKnownLevels(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"DEBUG", "DEBUG"},
		{"debug", "DEBUG"},
		{"WARN", "WARN"},
		{"ERROR", "ERROR"},
		{"nonsense", "INFO"},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			require.Equal(t, tt.want, Config{LogLevel: tt.in}.SlogLevel().String())
		})
	}
}
