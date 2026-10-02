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

// Command server runs the WSO2 Motor Rally backend: a chi REST API plus a
// WebSocket hub, backed by MySQL.
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	// Embeds the tz database, so EVENT_TIME_ZONE resolves on a minimal
	// container image that ships no /usr/share/zoneinfo. Without it, the zone
	// that decides when every car is released would fail to load in Choreo.
	_ "time/tzdata"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/config"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/middleware"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
)

const (
	readHeaderTimeout = 10 * time.Second
	shutdownTimeout   = 15 * time.Second
)

func main() {
	if err := run(); err != nil {
		// The logger may not exist yet when config loading fails, so report to
		// stderr through the default logger and exit non-zero.
		slog.Error("server startup failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	migrateOnly := flag.Bool("migrate", false, "apply database migrations and exit")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.SlogLevel()}))
	slog.SetDefault(logger)

	db, err := store.Open(cfg.DBDsn)
	if err != nil {
		return err
	}
	defer closeDB(db, logger)

	// The schema is applied on every boot so a fresh Choreo deployment is
	// usable without a separate migration step.
	if err := store.Migrate(db); err != nil {
		return err
	}
	logger.Info("database migrations applied")
	if *migrateOnly {
		return nil
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	organizer, err := newOrganizerValidator(ctx, cfg, logger)
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr: ":" + cfg.Port,
		Handler: newRouter(deps{
			cfg:        cfg,
			db:         db,
			logger:     logger,
			organizer:  organizer,
			background: ctx,
		}),
		ReadHeaderTimeout: readHeaderTimeout,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("server listening", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	logger.Info("server stopped")

	return nil
}

// closeDB releases the pool on shutdown, logging rather than swallowing a
// close failure.
func closeDB(db *sql.DB, logger *slog.Logger) {
	if err := db.Close(); err != nil {
		logger.Error("failed to close database pool", "error", err)
	}
}

// newOrganizerValidator picks how organizer id tokens are checked.
//
// Deployed environments validate signatures against Asgardeo's JWKS. Local
// development has no tenant to call, so it can fall back to decoding claims
// without verification — but only when TOKEN_VALIDATOR_ENABLED is explicitly
// "false". Anything else, including an unset variable, verifies, and
// config.Load refuses to start without an endpoint to verify against.
func newOrganizerValidator(ctx context.Context, cfg config.Config, logger *slog.Logger) (middleware.OrganizerValidator, error) {
	if !cfg.TokenValidatorEnabled {
		logger.Warn("organizer token signatures are NOT being verified because " +
			"TOKEN_VALIDATOR_ENABLED=false; any forged token is accepted. " +
			"Never set this outside local development")
		return authz.NewDecodeOnlyValidator(), nil
	}

	validator, err := authz.NewJWKSValidator(ctx, cfg.JWKSEndpoint)
	if err != nil {
		return nil, err
	}
	logger.Info("organizer tokens validated against JWKS", "endpoint", cfg.JWKSEndpoint)

	return validator, nil
}
