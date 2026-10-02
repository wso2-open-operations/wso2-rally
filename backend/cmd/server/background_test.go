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
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// The scheduler must keep ticking after a failure: one database blip at 08:59
// cannot be allowed to cancel the 09:00 start.
func TestRunPeriodically_KeepsTickingThroughErrors(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var calls atomic.Int32
	fire := func(context.Context) error {
		calls.Add(1)
		return errors.New("db down")
	}

	done := make(chan struct{})
	go func() {
		runPeriodically(ctx, "test", fire, time.Millisecond, slog.New(slog.NewTextHandler(io.Discard, nil)))
		close(done)
	}()

	require.Eventually(t, func() bool { return calls.Load() >= 3 }, time.Second, time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runPeriodically did not stop when its context was cancelled")
	}
}
