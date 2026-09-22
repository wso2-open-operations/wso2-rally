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

// Package middleware holds the cross-cutting HTTP layers wrapped around every
// route: correlation ids, panic recovery, security headers, access logging,
// dev-only CORS, and authentication.
//
// These are the Go equivalents of the customer-portal Ballerina interceptors.
package middleware

import (
	"bufio"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/store"
)

// RequestIDHeader carries the correlation id in and out of the service.
const RequestIDHeader = "X-Request-Id"

// hstsMaxAge is two years, the value Choreo's gateway also advertises.
const hstsMaxAge = "max-age=63072000; includeSubDomains"

// RequestID attaches a correlation id to the request context and echoes it on
// the response. An id supplied by the caller (or the Choreo gateway) is kept so
// a single trace spans both hops.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(RequestIDHeader)
		if id == "" {
			id = store.NewID()
		}
		w.Header().Set(RequestIDHeader, id)
		next.ServeHTTP(w, r.WithContext(httpx.WithRequestID(r.Context(), id)))
	})
}

// SecurityHeaders sets the response hardening headers. This service returns
// JSON only, so the policy denies framing and any embedded content outright.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Strict-Transport-Security", hstsMaxAge)
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// Recover converts a panic into a logged 500 so one bad request cannot take
// the process down mid-rally.
func Recover(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				rec := recover()
				if rec == nil {
					return
				}
				// The client hung up. net/http expects this to propagate.
				if err, ok := rec.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(rec)
				}
				logger.Error("recovered from panic",
					"panic", rec,
					"method", r.Method,
					"path", r.URL.Path,
					"request_id", httpx.RequestIDFrom(r.Context()),
				)
				httpx.WriteError(w, http.StatusInternalServerError, httpx.MsgInternal)
			}()

			next.ServeHTTP(w, r)
		})
	}
}

// Logger records one line per request: method, path, status, duration, and the
// correlation id.
func Logger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rec, r)

			logger.Info("request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", httpx.RequestIDFrom(r.Context()),
			)
		})
	}
}

// CORS enables a permissive layer for local development only, and only for the
// single configured origin. In Choreo the gateway owns CORS and allowOrigin is
// empty, making this a no-op.
func CORS(allowOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if allowOrigin == "" {
			return next
		}

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Origin") == allowOrigin {
				h := w.Header()
				h.Set("Access-Control-Allow-Origin", allowOrigin)
				h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
				h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, "+RequestIDHeader)
				h.Set("Access-Control-Allow-Credentials", "true")
				h.Add("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// statusRecorder remembers the status code for the access log.
//
// It forwards Unwrap, Flush, and Hijack so the WebSocket upgrade on /ws can
// still reach the raw connection through http.ResponseController.
type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (s *statusRecorder) WriteHeader(status int) {
	if s.wroteHeader {
		return
	}
	s.status = status
	s.wroteHeader = true
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if !s.wroteHeader {
		s.WriteHeader(http.StatusOK)
	}
	return s.ResponseWriter.Write(b)
}

// Unwrap exposes the wrapped writer to http.ResponseController.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("middleware: underlying ResponseWriter does not support hijacking")
	}
	return h.Hijack()
}
