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

package realtime

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/require"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
)

const testTopic = "event:0123456789abcdef0123456789abcdef"

func newTestHub(t *testing.T) *Hub {
	t.Helper()

	return NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// receive waits briefly for one message, failing rather than hanging.
func receive(t *testing.T, messages <-chan []byte) map[string]any {
	t.Helper()

	select {
	case raw, ok := <-messages:
		require.True(t, ok, "the subscription closed before delivering")
		var decoded map[string]any
		require.NoError(t, json.Unmarshal(raw, &decoded))
		return decoded
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for a broadcast")
		return nil
	}
}

func TestHub_BroadcastReachesSubscriber(t *testing.T) {
	hub := newTestHub(t)
	messages, unsubscribe := hub.Subscribe(testTopic)
	defer unsubscribe()

	hub.Broadcast(testTopic, map[string]any{"type": "score_delta", "total": 50})

	got := receive(t, messages)
	require.Equal(t, "score_delta", got["type"])
	require.InDelta(t, 50, got["total"], 0.001)
}

func TestHub_BroadcastReachesEverySubscriberOfATopic(t *testing.T) {
	hub := newTestHub(t)
	first, closeFirst := hub.Subscribe(testTopic)
	defer closeFirst()
	second, closeSecond := hub.Subscribe(testTopic)
	defer closeSecond()

	hub.Broadcast(testTopic, map[string]any{"type": "leaderboard"})

	require.Equal(t, "leaderboard", receive(t, first)["type"])
	require.Equal(t, "leaderboard", receive(t, second)["type"])
}

func TestHub_TopicsAreIsolated(t *testing.T) {
	hub := newTestHub(t)
	eventMessages, closeEvent := hub.Subscribe(testTopic)
	defer closeEvent()
	sessionMessages, closeSession := hub.Subscribe("session:abc")
	defer closeSession()

	hub.Broadcast(testTopic, map[string]any{"type": "alert"})

	require.Equal(t, "alert", receive(t, eventMessages)["type"])
	select {
	case <-sessionMessages:
		t.Fatal("a message leaked into another topic")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestHub_UnsubscribeStopsDelivery(t *testing.T) {
	hub := newTestHub(t)
	messages, unsubscribe := hub.Subscribe(testTopic)

	unsubscribe()
	hub.Broadcast(testTopic, map[string]any{"type": "alert"})

	_, open := <-messages
	require.False(t, open, "the channel closes on unsubscribe")
	require.Zero(t, hub.SubscriberCount(testTopic))
}

func TestHub_UnsubscribeIsIdempotent(t *testing.T) {
	hub := newTestHub(t)
	_, unsubscribe := hub.Subscribe(testTopic)

	unsubscribe()

	require.NotPanics(t, unsubscribe, "a double unsubscribe must not close the channel twice")
}

func TestHub_BroadcastToAnEmptyTopicIsSafe(t *testing.T) {
	hub := newTestHub(t)

	require.NotPanics(t, func() { hub.Broadcast("nobody-here", map[string]any{"type": "alert"}) })
}

// A screen that stops reading must not block the crew whose submission
// produced the message.
func TestHub_SlowSubscriberIsDroppedNotBlocking(t *testing.T) {
	hub := newTestHub(t)
	_, unsubscribe := hub.Subscribe(testTopic)
	defer unsubscribe()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for range subscriberBuffer * 2 {
			hub.Broadcast(testTopic, map[string]any{"type": "vehicle_position"})
		}
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Broadcast blocked on a subscriber that stopped reading")
	}
	require.Positive(t, hub.Dropped(), "shed messages are counted")
}

func TestHub_UnencodableMessageIsLoggedNotPanicked(t *testing.T) {
	hub := newTestHub(t)
	messages, unsubscribe := hub.Subscribe(testTopic)
	defer unsubscribe()

	require.NotPanics(t, func() { hub.Broadcast(testTopic, make(chan int)) })

	select {
	case <-messages:
		t.Fatal("an unencodable message must not be delivered")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestHub_ConcurrentSubscribeAndBroadcast(t *testing.T) {
	hub := newTestHub(t)
	var wg sync.WaitGroup

	for i := range 20 {
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, unsubscribe := hub.Subscribe(testTopic)
			unsubscribe()
		}()
		go func() {
			defer wg.Done()
			hub.Broadcast(testTopic, map[string]any{"type": "vehicle_position", "n": i})
		}()
	}

	wg.Wait()
	require.Zero(t, hub.SubscriberCount(testTopic))
}

func TestHub_ServeWSStreamsTheTopic(t *testing.T) {
	hub := newTestHub(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, testTopic)
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+server.URL[len("http"):], nil)
	require.NoError(t, err)
	defer func() { _ = conn.CloseNow() }()

	// Wait for ServeWS to register before broadcasting.
	require.Eventually(t, func() bool { return hub.SubscriberCount(testTopic) == 1 },
		2*time.Second, 10*time.Millisecond)

	hub.Broadcast(testTopic, map[string]any{"type": "start_signal"})

	_, raw, err := conn.Read(ctx)
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, json.Unmarshal(raw, &got))
	require.Equal(t, "start_signal", got["type"])
}

func TestHub_ServeWSUnsubscribesOnDisconnect(t *testing.T) {
	hub := newTestHub(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, testTopic)
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+server.URL[len("http"):], nil)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return hub.SubscriberCount(testTopic) == 1 },
		2*time.Second, 10*time.Millisecond)

	require.NoError(t, conn.Close(websocket.StatusNormalClosure, "done"))

	require.Eventually(t, func() bool { return hub.SubscriberCount(testTopic) == 0 },
		2*time.Second, 10*time.Millisecond, "a disconnected client must be unsubscribed")
}

// Without an allow-list, only same-origin browsers may connect — otherwise any
// site could open a socket to the rally backend.
func TestHub_ServeWSRejectsAForeignOrigin(t *testing.T) {
	hub := newTestHub(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, testTopic)
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := websocket.Dial(ctx, "ws"+server.URL[len("http"):], &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"https://evil.example"}},
	})

	require.Error(t, err)
	require.Zero(t, hub.SubscriberCount(testTopic))
}

func TestHub_ServeWSAllowsAConfiguredOrigin(t *testing.T) {
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)), "trusted.example")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, testTopic)
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+server.URL[len("http"):], &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"https://trusted.example"}},
	})

	require.NoError(t, err)
	_ = conn.CloseNow()
}

// Broadcast runs concurrently from many request handlers. Counting a dropped
// message must not race with another goroutine doing the same.
func TestHub_ConcurrentDropsDoNotRace(t *testing.T) {
	hub := newTestHub(t)
	_, unsubscribe := hub.Subscribe(testTopic)
	defer unsubscribe()

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range subscriberBuffer {
				hub.Broadcast(testTopic, map[string]any{"type": "vehicle_position"})
			}
		}()
	}
	wg.Wait()

	require.Positive(t, hub.Dropped())
}

// A browser sends its credential as a subprotocol, and RFC 6455 requires the
// server to name one of the offered protocols in its response — a handshake
// that agrees on none is closed by the browser straight after opening. So the
// hub has to echo the marker back, and must not echo the token itself.
func TestHub_ServeWSNegotiatesTheBearerSubprotocol(t *testing.T) {
	hub := newTestHub(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, testTopic)
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+server.URL[len("http"):], &websocket.DialOptions{
		Subprotocols: []string{authz.BearerSubprotocol, "a-token-shaped-string"},
	})
	require.NoError(t, err)
	defer func() { _ = conn.CloseNow() }()

	require.Equal(t, authz.BearerSubprotocol, conn.Subprotocol(),
		"the agreed subprotocol must be the marker, never the token")
}

// A client that offers nothing still connects: the micro app and the organizer
// app both send a token, but a Postman or curl session with a header does not.
func TestHub_ServeWSStillAcceptsAClientOfferingNoSubprotocol(t *testing.T) {
	hub := newTestHub(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hub.ServeWS(w, r, testTopic)
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+server.URL[len("http"):], nil)
	require.NoError(t, err)
	defer func() { _ = conn.CloseNow() }()

	require.Empty(t, conn.Subprotocol())
}
