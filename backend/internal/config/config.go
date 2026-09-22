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

// Package config loads and validates the backend's environment configuration.
//
// Load fails loudly on a missing or malformed required key rather than
// starting the server in a half-configured state.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"
)

// Default values applied when the corresponding environment variable is unset.
const (
	defaultPort         = "8080"
	defaultLogLevel     = "INFO"
	defaultAdminRole    = "rally-admin"
	defaultTeamTokenTTL = 12 * time.Hour
)

// Config holds every runtime setting the server needs. It is read once at
// startup and passed by value; nothing mutates it afterwards.
type Config struct {
	// Port is the TCP port the HTTP server listens on.
	Port string
	// DBDsn is the MySQL data source name. Required.
	DBDsn string
	// TeamTokenSecret signs participant (team) JWTs. Required.
	TeamTokenSecret string
	// TeamTokenTTL is how long a minted team token stays valid.
	TeamTokenTTL time.Duration
	// JWKSEndpoint serves the Asgardeo public keys. Required unless
	// TOKEN_VALIDATOR_ENABLED is explicitly "false".
	JWKSEndpoint string
	// TokenValidatorEnabled turns on full JWKS signature validation for
	// organizer tokens.
	//
	// It defaults to true, and only the exact value "false" turns it off. An
	// operator who forgets the variable gets verification; one who wants the
	// decode-only local path has to ask for it in writing. The reverse default
	// meant a deployment that merely omitted the variable would boot with a
	// warning and then accept any forged token carrying groups: ["admin"].
	TokenValidatorEnabled bool
	// AdminRole is the group claim that grants organizer admin actions.
	AdminRole string
	// OrganizerRole is the group claim that admits someone to the organizer
	// surface at all.
	//
	// It exists because the in-car app is embedded in the super app, so every
	// participant holds a valid Asgardeo token: "has a decodable organizer
	// token" stopped meaning "is staff". Defaults to AdminRole, which keeps a
	// deployment that only ever configured one group working unchanged.
	OrganizerRole string
	// CORSAllowOrigin enables a permissive dev-only CORS layer when set. In
	// Choreo the gateway owns CORS and this stays empty.
	CORSAllowOrigin string
	// LogLevel is one of DEBUG, INFO, WARN, ERROR.
	LogLevel string
}

// Load reads the configuration from the process environment.
//
// It returns an error naming every missing required key, so a misconfigured
// deployment reports all its problems in one startup attempt.
func Load() (Config, error) {
	c := Config{
		Port:                  getenv("PORT", defaultPort),
		DBDsn:                 os.Getenv("DB_DSN"),
		TeamTokenSecret:       os.Getenv("TEAM_TOKEN_SECRET"),
		TeamTokenTTL:          defaultTeamTokenTTL,
		JWKSEndpoint:          os.Getenv("JWKS_ENDPOINT"),
		TokenValidatorEnabled: !strings.EqualFold(os.Getenv("TOKEN_VALIDATOR_ENABLED"), "false"),
		AdminRole:             getenv("ADMIN_ROLE", defaultAdminRole),
		OrganizerRole:         os.Getenv("ORGANIZER_ROLE"), // defaulted to AdminRole below
		CORSAllowOrigin:       os.Getenv("CORS_ALLOW_ORIGIN"),
		LogLevel:              strings.ToUpper(getenv("LOG_LEVEL", defaultLogLevel)),
	}

	// Fail closed rather than open: with no organizer group configured, only
	// the admin group reaches the organizer surface.
	if c.OrganizerRole == "" {
		c.OrganizerRole = c.AdminRole
	}

	if raw := os.Getenv("TEAM_TOKEN_TTL"); raw != "" {
		ttl, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("config error: TEAM_TOKEN_TTL is not a valid duration: %w", err)
		}
		if ttl <= 0 {
			return Config{}, fmt.Errorf("config error: TEAM_TOKEN_TTL must be positive, got %s", ttl)
		}
		c.TeamTokenTTL = ttl
	}

	var missing []string
	if c.DBDsn == "" {
		missing = append(missing, "DB_DSN")
	}
	if c.TeamTokenSecret == "" {
		missing = append(missing, "TEAM_TOKEN_SECRET")
	}
	if c.TokenValidatorEnabled && c.JWKSEndpoint == "" {
		missing = append(missing, "JWKS_ENDPOINT")
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("config error: missing required env: %s", strings.Join(missing, ", "))
	}

	return c, nil
}

// SlogLevel maps LogLevel onto a slog level, falling back to INFO for an
// unrecognised value.
func (c Config) SlogLevel() slog.Level {
	switch strings.ToUpper(c.LogLevel) {
	case "DEBUG":
		return slog.LevelDebug
	case "WARN":
		return slog.LevelWarn
	case "ERROR":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
