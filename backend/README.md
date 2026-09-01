<!--
Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
Licensed under the Apache License, Version 2.0.
-->

# Rally Backend

The game engine for **WSO2 Motor Rally 2027**: a chi REST API plus a WebSocket
hub, backed by MySQL. It serves two very different callers from one service —
organizers running the rally from a browser, and one phone per car running it
from the passenger seat.

Design spec: [`docs/specs/2026-07-24-wso2-motor-rally-design.md`](../docs/specs/2026-07-24-wso2-motor-rally-design.md).

## Prerequisites

- **Go 1.25** or newer (`go.mod` sets `go 1.25.6`)
- A container runtime for the local MySQL — Docker Desktop, or Rancher Desktop
  with `nerdctl`. `make docker-db` picks whichever the machine has.

## Running it locally

**1. Configure.** Copy the example and edit it. Every key is documented in
place; the two that matter locally are `DB_DSN` and `TEAM_TOKEN_SECRET`.

```bash
cp config.example.env config.env
set -a && source config.env && set +a
```

`config.Load` fails at startup naming every missing required key at once, so a
misconfigured environment is fixed in one pass rather than one restart per key.

**2. Start the database.** MySQL 8.4 on `:3306`, with a `rally` schema and a
`rally` user, from `docker-compose.yml`.

```bash
make docker-db
```

If this fails with *"Rancher Desktop is not running"*, start Rancher Desktop (or
Docker Desktop) first — nothing else in this section works without a database.

**3. Run the server.** Migrations apply on boot, then it listens on `:8080`.

```bash
make run
```

You should see:

```
{"level":"INFO","msg":"database migrations applied"}
{"level":"WARN","msg":"organizer token signatures are NOT being verified; ..."}
{"level":"INFO","msg":"server listening","port":"8080"}
```

That warning is expected locally and is the subject of the note below.

**4. Check it.**

```bash
curl localhost:8080/health
# {"status":"ok"}
```

### Calling the authenticated API locally

`GET /health` is the only route that needs no token. Everything else returns
`401` without one. `config.example.env` sets `TOKEN_VALIDATOR_ENABLED=false`
for local work — it is an opt-out, not the default — so the service *decodes*
organizer claims without verifying the signature, which means you can mint
yourself a token with no Asgardeo tenant at all:

```bash
TOKEN=$(python3 -c '
import base64, json, time
b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
print(b64({"alg":"RS256","typ":"JWT"}) + "." + b64({
    "iss":"https://api.asgardeo.io/t/local", "sub":"dev-organizer",
    "email":"dev@wso2.com", "groups":["rally-admin"],
    "exp":int(time.time())+86400}) + ".not-verified-in-decode-only-mode")')

curl -s -H "Authorization: Bearer $TOKEN" localhost:8080/users/me
# {"email":"dev@wso2.com","groups":["rally-admin"],"userId":"dev-organizer"}

curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"offset":0,"limit":20,"filters":{}}' localhost:8080/events/search
```

The `iss` can be anything except `rally-team`, which is reserved for team tokens
and rejected on the organizer path so a crew token cannot be replayed as staff.

> The signature is never checked here, but it must still be **decodable**
> base64url — the JWT parser decodes all three segments before it looks at any
> claim. That means its length may not be `1 mod 4`: the 32-character filler
> above works, and a 29-character one would fail with
> `could not base64 decode signature`, which surfaces as a plain `401`.

## Building

```bash
make build            # → bin/server, a single static binary
go build ./...        # compile check only
```

`make migrate-up` applies the schema and exits, for a deploy step that wants
migrations separate from the rollout.

## Poking at it by hand

Import [`api/rally.postman_collection.json`](api/rally.postman_collection.json)
into Postman. Run the folders top to bottom: each request that creates something
stores its id in a collection variable, so the whole rally — set up a course,
provision a car, bind a phone, drive into a geofence, submit a task, finish —
runs without editing a single id by hand.

Organizer requests use `{{organizerToken}}`, which a collection pre-request
script mints for decode-only mode when it is empty. That token only works
locally; paste a real Asgardeo id token in for a deployed environment. Crew
requests use `{{teamToken}}`, captured from `POST /sessions/join`.

It runs headless too, which is the fastest smoke test of a live server:

```bash
npx newman run api/rally.postman_collection.json
```

## Testing

```bash
make test              # unit tests; DB-backed tests skip themselves
make docker-db
make test-integration  # everything, including the full happy-path walkthrough
make lint              # gofmt + go vet
```

Tests that need a database read `TEST_DB_DSN` and call `t.Skip` when it is
unset, so `go test ./...` stays green on a machine without Docker. **A green
`make test` therefore does not mean the SQL was exercised** — run
`make test-integration` before trusting a schema or repository change. That
target passes `-count=1`, because a cached `ok` from a run without a database
would otherwise report success for tests that skipped.

DB-backed tests hold a MySQL advisory lock (`wso2_rally_test`) for their
duration, so they run one at a time. `go test ./...` runs package binaries in
parallel and they all share one database; without the lock, one package's
truncation wipes rows another has just seeded. Per-database isolation would be
faster, but the compose-provisioned user cannot `CREATE DATABASE`.

`make docker-db` picks `docker compose` or `nerdctl compose`, whichever the
machine has — Rancher Desktop in containerd mode has no dockerd for
`docker compose` to talk to.

## The two identities

| Caller | Credential | How it is checked |
|---|---|---|
| Organizer | Asgardeo id token | JWKS signature validation, unless `TOKEN_VALIDATOR_ENABLED=false` explicitly turns it off |
| Crew | Team JWT minted by `POST /sessions/join` | HMAC signature, `iss=rally-team`, expiry, and a device claim |

Both arrive as `Authorization: Bearer <token>`. The auth middleware tries the
team token first — it is cheap and carries our own issuer — and hands anything
else to the organizer validator. Requests then pass a role gate:
`RequireOrganizer`, `RequireTeam`, or `RequireAdmin`.

> **Decode-only mode is for local development only.** Signature validation is
> on by default and only the literal `TOKEN_VALIDATOR_ENABLED=false` turns it
> off, at which point the service trusts organizer claims without checking a
> signature and logs a warning at startup saying so. Forgetting the variable
> gets you verification, not the decode-only path — the reverse default meant a
> deployment that merely omitted it would accept any forged token carrying
> `groups: ["admin"]`. Anything but the opt-out needs `JWKS_ENDPOINT`, and
> `config.Load` refuses to start without it. It still does **not** refuse an
> explicit `false`: nothing but review stops that value reaching a deployed
> environment.

`POST /sessions/join` is the only unauthenticated write: joining a vehicle is
what authenticates a crew, so there is no credential to present beforehand. It
is guarded instead by the last four digits of the member's own phone number,
checked against the roster.

## How a rally runs

1. An organizer creates an event, draws the start and finish geofences, orders
   the waypoints of each route, attaches tasks to them, and provisions vehicles
   and crews (by hand or by CSV).
2. Publishing the event opens it to crews. Both geofences must be placed first,
   or the start could never lock and arrival could never be detected.
3. Each crew member picks their vehicle, picks their own name, and types the
   last four digits of their own number. `POST /sessions/join` mints that
   phone's team token. **Every phone in a car shares one session**: the first to
   arrive creates it and the rest find it, so a crew cannot end up split across
   two runs. One live session per vehicle is enforced by a unique index on
   `(vehicle_id, active_flag)`, and re-joining is an upsert — a rebooted or
   borrowed phone lands back on the same device row rather than erroring.
4. A phone streams position to `POST /sessions/me/location`. **The server
   decides what that position means**: it evaluates every waypoint boundary,
   returns which tasks unlocked, and raises rest-lock, trivia, and arrival
   events.
5. Submissions go to `POST /sessions/me/tasks/{taskId}/submit`. The
   `taskengine` validates and scores them against the task's config; the phone
   never decides whether it was right, and cannot earn more than the task is
   worth.
6. Arriving inside the finish geofence auto-finishes the session, locks the
   score, and issues the crew's voucher.

## Layout

```
cmd/server/          wiring: config → store → services → router → listener
internal/
  config/            env loading and validation
  httpx/             JSON, the {"message": ...} error shape, paging
  apperr/            the shared error categories every domain maps onto
  authz/             team tokens, organizer JWTs, Identity, role checks
  middleware/        request id, recovery, security headers, logging, auth
  store/             MySQL pool, id generation, transactions, migrations
  geo/               haversine and point-in-radius
  realtime/          the WebSocket hub
  taskengine/        one validator and scorer per task type
  events/ routes/ tasks/ vehicles/ alerts/ sessions/ scoring/ debrief/
api/                 openapi.yaml (REST), asyncapi.yaml (WebSocket)
.choreo/             deployment descriptor
```

Every domain package follows the same shape, mirroring the Ballerina module
split the rest of the platform uses:

| File | Holds |
|---|---|
| `<name>.go` | domain types, enums, sentinel errors |
| `service.go` | the rules, plus the `Repo` interface it depends on |
| `repo.go` | the SQL behind that interface |
| `dto.go` | wire shapes and the mappers to and from the domain |
| `handler.go` | HTTP routes |

Services depend on `Repo` interfaces, so their rules are tested against an
in-memory fake and the SQL is tested separately against a real MySQL.

## Conventions

- Every non-2xx body is exactly `{"message": "..."}`. Internal detail is
  logged with the request id, never returned.
- No silent fallbacks: a database or parse error is handled or returned, never
  swallowed into a zero value.
- Entity ids are 32-character lowercase hex from `store.NewID`, generated with
  `crypto/rand` because they appear in URLs and tokens.
- Lists are `POST /<resource>/search` with `{offset, limit, filters}`; the
  limit defaults to 20 and caps at 100.
- `GET /health` is unauthenticated, for Choreo's probe.
- Apache-2.0 header on every source file.

## Things worth knowing before you change them

- **`trigger` is a MySQL reserved word.** Every query touching `task.trigger`
  backticks it.
- **Task answers are stripped for crews.** `GET /tasks/{id}` is read by both
  identities; `tasks.RedactForCrew` removes the scoring keys before the
  definition reaches a phone. **Any new config key that decides a score must be
  added to `secretConfigKeys`**, or it ships to the car with the question.
- **The WebSocket token arrives as a subprotocol, not a header.** A browser
  cannot set one on a handshake, so `middleware.Auth` falls back to
  `Sec-WebSocket-Protocol: rally-bearer, <token>` (`authz.BearerSubprotocol`)
  when there is no `Authorization` header. Deliberately *not* a query parameter:
  the request logger, the browser's history and every proxy would record it.
  `realtime.Hub` must keep echoing the marker back on accept — RFC 6455 lets a
  browser close a connection that agreed on none of the protocols it offered —
  and must never echo the token, which would put the credential in a response
  header.
- **A vehicle can be deleted only before it runs.** Sessions, submissions,
  scores and alerts all hang off `vehicle` by a cascading foreign key, so
  `DELETE /vehicles/{id}` checks `team_session` first and returns 409 if the car
  has any. The delete exists to fix provisioning, never to retire a car
  mid-rally.
- **A timestamp you do arithmetic on needs `TIMESTAMP(3)`.** A bare `TIMESTAMP`
  has no fractional seconds and MySQL *rounds* to the nearest second on write,
  so a value can come back up to half a second in the **future**. That is
  invisible for a display column and poison for a computed one: it silently
  disarmed the anti-teleport check on `last_ping_at` (a negative elapsed time
  reads as a backwards clock, which accepts any jump) and rounded two crews
  finishing 300 ms apart into a leaderboard dead heat. `0002` fixes those two;
  the rest are display or audit values and stay at second resolution.
- **Broadcasts are best-effort.** A subscriber that stops reading loses
  messages rather than blocking the crew whose submission produced them; the
  count is exposed by `Hub.Dropped`.
- **The leaderboard is composed at the wiring layer.** `sessions` publishes a
  score change and `cmd/server` turns that into a refreshed leaderboard, so the
  in-car runtime does not depend on `scoring`.
