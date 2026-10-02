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
	"fmt"
	"time"
)

// CoverageAlarmAfter is how long a car on the course may go without any phone
// reporting before the crew and the organizer are warned.
//
// It is deliberately much shorter than SharingWindow. That window only decides
// whether a phone shows as "sharing", and is generous so the indicator does not
// flicker. This one decides when the car has gone dark, and a waypoint's 40 m
// circle is crossed in about five seconds at 60 km/h — every second without a
// report can be a checkpoint the car drives past with nothing unlocked.
const CoverageAlarmAfter = 30 * time.Second

// SessionCoverage is when a run on the course last heard from any of its phones.
type SessionCoverage struct {
	SessionID   string
	EventID     string
	VehicleCode string
	// LastReportAt is the most recent report from any phone in the car, stamped
	// when it arrived. Nil when no phone has ever reported.
	LastReportAt *time.Time
}

// CoverageLost reports whether a car has gone dark: no phone has reported for
// longer than CoverageAlarmAfter.
//
// A car with no report at all is dark too. A guard that cannot judge must deny,
// and here denying means raising the warning rather than assuming the car is
// covered.
func CoverageLost(lastReportAt *time.Time, now time.Time) bool {
	return lastReportAt == nil || now.Sub(*lastReportAt) > CoverageAlarmAfter
}

// CheckCoverage warns every car on the course that has gone dark, and clears
// the warning when it recovers. It is meant to be called every second.
//
// The driver's phone stops reporting the moment they open Google Maps, so the
// rally relies on a passenger's phone to keep the car's position live. When
// none is, geofences are only evaluated when the driver comes back — by then
// the checkpoint is behind them. So each transition is announced twice: on the
// session topic, so every open phone in the car can ask someone to keep the
// rally app open, and on the event topic, so the organizer's monitor can flag
// the car.
//
// A car announced as dark that leaves the course — it finished — gets a closing
// coverage_restored on the event topic, or its flag would stay up on the
// monitor for the rest of the day.
func (s *Service) CheckCoverage(ctx context.Context) error {
	cars, err := s.repo.ActiveSessionCoverage(ctx)
	if err != nil {
		return fmt.Errorf("list coverage of active sessions: %w", err)
	}

	now := s.now()
	s.darkMu.Lock()
	defer s.darkMu.Unlock()

	onCourse := make(map[string]bool, len(cars))
	for _, car := range cars {
		onCourse[car.SessionID] = true
		_, announced := s.dark[car.SessionID]
		lost := CoverageLost(car.LastReportAt, now)

		switch {
		case lost && !announced:
			s.dark[car.SessionID] = car
			s.broadcast(SessionTopic(car.SessionID), map[string]any{
				"type":         "coverage_lost",
				"lastReportAt": reportedAt(car.LastReportAt),
			})
			s.broadcast(EventTopic(car.EventID), map[string]any{
				"type":         "coverage_lost",
				"vehicleCode":  car.VehicleCode,
				"lastReportAt": reportedAt(car.LastReportAt),
			})
			s.logger().Warn("car has no phone sharing location",
				"session_id", car.SessionID, "vehicle_code", car.VehicleCode)
		case !lost && announced:
			delete(s.dark, car.SessionID)
			s.broadcast(SessionTopic(car.SessionID), map[string]any{"type": "coverage_restored"})
			s.broadcast(EventTopic(car.EventID), map[string]any{
				"type": "coverage_restored", "vehicleCode": car.VehicleCode,
			})
		}
	}

	for sessionID, car := range s.dark {
		if !onCourse[sessionID] {
			delete(s.dark, sessionID)
			s.broadcast(EventTopic(car.EventID), map[string]any{
				"type": "coverage_restored", "vehicleCode": car.VehicleCode,
			})
		}
	}

	return nil
}

// reportedAt renders a last-report time for the wire, or nil when there was none.
func reportedAt(at *time.Time) any {
	if at == nil {
		return nil
	}

	return at.UTC().Format(time.RFC3339)
}
