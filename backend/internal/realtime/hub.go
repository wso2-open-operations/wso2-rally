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

// Package realtime is the WebSocket fan-out behind the organizer's live
// monitor, the pavilion leaderboard, and the in-car start signal.
//
// Delivery is best-effort by design: a rally screen wants the current state,
// not a replay. A subscriber that cannot keep up loses messages rather than
// stalling the crew whose submission produced them.
package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/authz"
)

const (
	// subscriberBuffer is how many messages a slow screen may fall behind
	// before it starts dropping them.
	subscriberBuffer = 32
	// pingInterval keeps idle connections alive through Choreo's gateway and
	// mobile NAT timeouts.
	pingInterval = 30 * time.Second
	// writeTimeout bounds a single frame write to one client.
	writeTimeout = 10 * time.Second
)

// subscriber is one connected screen or phone.
type subscriber struct {
	messages chan []byte
}

// Hub fans messages out to the subscribers of a topic.
//
// Topics are "event:{id}" for organizers and "session:{id}" for one in-car
// phone; the hub itself does not interpret them.
type Hub struct {
	mu     sync.RWMutex
	topics map[string]map[*subscriber]struct{}
	logger *slog.Logger
	// originPatterns are the extra browser origins allowed to open a socket,
	// beyond the service's own. Empty means same-origin only.
	originPatterns []string
	// dropped counts messages shed from full buffers, so a struggling client
	// is visible in the logs rather than silently lossy.
	//
	// It is atomic because Broadcast counts under a *read* lock, which several
	// request handlers hold at once.
	dropped atomic.Int64
}

// NewHub returns an empty hub.
//
// originPatterns lists the cross-origin hosts permitted to connect — in
// practice the local dev server, since in Choreo the front ends are served
// from the same origin. Leaving it empty keeps the library's same-origin
// check, which is what stops another site opening a socket to this backend.
func NewHub(logger *slog.Logger, originPatterns ...string) *Hub {
	if logger == nil {
		logger = slog.Default()
	}

	allowed := make([]string, 0, len(originPatterns))
	for _, pattern := range originPatterns {
		if pattern != "" {
			allowed = append(allowed, pattern)
		}
	}

	return &Hub{
		topics:         map[string]map[*subscriber]struct{}{},
		logger:         logger,
		originPatterns: allowed,
	}
}

// Subscribe registers for a topic and returns the channel to read plus the
// function that unregisters it. The caller must always invoke unsubscribe, or
// the hub keeps delivering to a channel nobody reads.
func (h *Hub) Subscribe(topic string) (<-chan []byte, func()) {
	sub := &subscriber{messages: make(chan []byte, subscriberBuffer)}

	h.mu.Lock()
	if h.topics[topic] == nil {
		h.topics[topic] = map[*subscriber]struct{}{}
	}
	h.topics[topic][sub] = struct{}{}
	h.mu.Unlock()

	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			h.mu.Lock()
			delete(h.topics[topic], sub)
			if len(h.topics[topic]) == 0 {
				delete(h.topics, topic)
			}
			h.mu.Unlock()
			close(sub.messages)
		})
	}

	return sub.messages, unsubscribe
}

// Broadcast marshals message and delivers it to every subscriber of topic.
//
// It never blocks: a subscriber whose buffer is full misses this message. That
// is the right trade for live views, where the next update supersedes this one
// anyway.
func (h *Hub) Broadcast(topic string, message any) {
	encoded, err := json.Marshal(message)
	if err != nil {
		h.logger.Error("failed to encode broadcast", "error", err, "topic", topic)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for sub := range h.topics[topic] {
		select {
		case sub.messages <- encoded:
		default:
			h.dropped.Add(1)
			h.logger.Warn("dropped a broadcast to a slow subscriber", "topic", topic)
		}
	}
}

// SubscriberCount reports how many clients are listening to a topic. It exists
// for tests and diagnostics.
func (h *Hub) SubscriberCount(topic string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()

	return len(h.topics[topic])
}

// Dropped reports how many messages have been shed from full buffers.
func (h *Hub) Dropped() int64 {
	return h.dropped.Load()
}

// ServeWS upgrades the request and streams the topic to it until the client
// disconnects or the server shuts down.
//
// The connection is read-only from the client's side: subscribers never send
// commands, so incoming frames are discarded and only used to notice a close.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, topic string) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: h.originPatterns,
		// A browser offers ["rally-bearer", "<token>"] because a WebSocket
		// handshake carries no Authorization header. RFC 6455 lets it close a
		// connection that agreed on none of the protocols it offered, so the
		// marker is echoed back — and only the marker, never the token, which
		// would otherwise appear in a response header.
		Subprotocols: []string{authz.BearerSubprotocol},
	})
	if err != nil {
		h.logger.Warn("websocket upgrade failed", "error", err, "topic", topic)
		return
	}
	defer func() { _ = conn.CloseNow() }()

	messages, unsubscribe := h.Subscribe(topic)
	defer unsubscribe()

	// CloseRead discards anything the client sends and cancels this context
	// the moment it hangs up.
	ctx := conn.CloseRead(r.Context())

	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case message, ok := <-messages:
			if !ok {
				return
			}
			if err := h.write(ctx, conn, message); err != nil {
				h.logger.Debug("websocket write failed, closing", "error", err, "topic", topic)
				return
			}
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func (h *Hub) write(ctx context.Context, conn *websocket.Conn, message []byte) error {
	writeCtx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()

	return conn.Write(writeCtx, websocket.MessageText, message)
}
