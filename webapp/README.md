<!--
 Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).

 WSO2 LLC. licenses this file to you under the Apache License,
 Version 2.0 (the "License"); you may not use this file except
 in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing,
 software distributed under the License is distributed on an
 "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 KIND, either express or implied.  See the License for the
 specific language governing permissions and limitations
 under the License.
-->

# Rally Ops — organizer web app

The organizer portal for **WSO2 Motor Rally 2027**. A React 19 SPA that talks to
the Go backend in [`../backend`](../backend) over REST, and (in later
increments) over WebSocket for the live monitor and leaderboard.

Conventions mirror
[`cs-tools/apps/customer-portal/webapp`](https://github.com/wso2-open-operations/cs-tools):
runtime `window.config`, Asgardeo auth, TanStack Query over a `fetch` client,
`react-router` 7, `@wso2/oxygen-ui`, feature-based `src/features/*`, ESLint flat
config and **no prettier**.

## What is built

| Screen | Route | Status |
| ------ | ----- | ------ |
| A1 Events dashboard | `/events` | ✅ |
| A2 Event setup | `/events/new`, `/events/:eventId/setup` | ✅ |
| A3 Routes & geofences | `/routes` | ✅ |
| A4 Task library | `/tasks` | ✅ |
| A5 Vehicles & crews | `/vehicles` | ✅ |
| A6 Live monitor | `/monitor` | ✅ |
| A7 Leaderboard | `/leaderboard` | placeholder |
| A8 Debrief | `/debrief` | placeholder |

The sidebar lists all seven features so navigation matches the product shape;
the unbuilt ones render a "not built yet" page rather than a dead 404.

---

## Prerequisites

- **Node.js 20.19+** or 22.12+. Vite 7 prints a warning below 20.19 — the dev
  server and build still run on 20.17, but it is not a supported combination.
- **pnpm 10+**. This app uses pnpm; the micro app uses npm. They are not
  interchangeable.

```bash
npm install -g pnpm@10
```

If `corepack enable pnpm` fails with a keyid or `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`
error, that is a known corepack/Node 20.17 problem — use the global install above
and `corepack disable pnpm`.

- **A running backend.** See [`../backend/README.md`](../backend/README.md). The
  app is useless without it: every page loads through `GET /users/me`.
- **An Asgardeo tenant.** Read the next section before you start — this one
  stops people.

---

## ⚠️ You need a real Asgardeo application

There is **no local auth bypass**. `AuthGuard` wraps every route in Asgardeo's
`ProtectedRoute`, so loading `http://localhost:3000` redirects straight to
Asgardeo before any of the app renders. With the placeholder values from
`config.js.example` you get:

> You are trying to access an invalid organization named `<your-tenant>`

The backend's `TOKEN_VALIDATOR_ENABLED=false` does **not** help here — that only
relaxes what the *backend* accepts. The browser still has to complete a real
OIDC sign-in to obtain a token to send.

To develop against the real thing, register a **Single-Page Application** in
your Asgardeo organization and set:

| Asgardeo setting | Value |
| --- | --- |
| Authorized redirect URL | `http://localhost:3000` |
| Allowed origin | `http://localhost:3000` |
| Grant type | Authorization code + PKCE (default for SPA) |
| Requested scopes | `openid`, `email`, `groups`, `profile` |

The `groups` claim must be in the id token — the backend reads it for the
organizer role, and the app shows the signed-in user from it.

If you only need to exercise the **API**, skip the web app entirely and use the
token recipe or the Postman collection in
[`../backend/README.md`](../backend/README.md).

---

## Getting started

**1. Install dependencies.**

```bash
pnpm install
```

**2. Create the runtime config.** `public/config.js` is gitignored — it is
per-environment configuration, not build input.

```bash
cp public/config.js.example public/config.js
```

Edit it and fill in, at minimum:

```js
RALLY_BACKEND_BASE_URL: "http://localhost:8080",
RALLY_ASGARDEO_BASE_URL: "https://api.asgardeo.io/t/<your-org>",
RALLY_ASGARDEO_CLIENT_ID: "<client id of the SPA you registered>",
RALLY_ASGARDEO_SIGN_IN_REDIRECT_URL: "http://localhost:3000",
RALLY_ASGARDEO_SIGN_OUT_REDIRECT_URL: "http://localhost:3000",
```

Every key is documented in `config.js.example`. The app **throws on startup**
rather than guessing when a required one is missing, so a typo surfaces
immediately instead of as a confusing 401 later.

**3. Make sure the backend allows this origin.** In `backend/config.env`:

```
CORS_ALLOW_ORIGIN=http://localhost:3000
```

This is dev-only. In Choreo the gateway owns CORS and the value stays empty.

**4. Run it.**

```bash
pnpm dev          # http://localhost:3000
```

---

## Commands

```bash
pnpm dev                          # dev server on :3000, HMR
pnpm build                        # tsc -b && vite build → dist/
pnpm preview                      # serve the built dist/ locally
pnpm test                         # vitest, watch mode
pnpm exec vitest run              # vitest, single run (115 tests)
pnpm exec vitest run src/config   # one directory
pnpm lint                         # eslint
```

Before pushing, the same three checks CI would run:

```bash
pnpm exec tsc -b && pnpm exec vitest run && pnpm lint
```

---

## Deployment

`pnpm build` produces `dist/`. The **same `dist/` is promoted across every
environment** — only `config.js` is swapped, which is the whole reason config is
read at runtime from `window.config` rather than baked in at build time.

The Choreo gateway owns TLS, CORS and organizer token validation.

---

## Architecture notes

- **`useAuthApiClient`** is the single path to the backend. It prefixes
  `RALLY_BACKEND_BASE_URL`, sends both `Authorization: Bearer <idToken>` and
  `x-user-id-token: <idToken>`, and raises any non-2xx as an `ApiError` carrying
  the backend's `{"message": …}`. Callers never check `response.ok`.
- **Query keys** come from `ApiQueryKeys` in `constants/apiConstants.ts`, so a
  mutation invalidates exactly what it touched.
- **Path aliases** must be declared in *both* `vite.config.ts` and
  `tsconfig.app.json`. `@types` is deliberately **not** an alias — it would
  shadow the DefinitelyTyped scope. Domain types import as `@/types/event`.
- **`jsdom` is pinned to 26.x.** jsdom 27 requires `require(esm)`, which lands
  in Node 20.19. Raise it once the team's Node floor moves.
- Maps are `react-leaflet` + OpenStreetMap tiles, with no API key, per the
  design spec. Leaflet measures the DOM, which jsdom does not lay out, so
  `vitest.setup.ts` stubs the whole module — add a stub there when a page starts
  using a react-leaflet component the mock does not list yet.
- **A3 and A5 send whole sets, never deltas.** Reordering posts the full
  permutation, attaching a task posts the waypoint's complete task list, and
  saving a vehicle posts its complete crew — those endpoints replace rather than
  merge, so a partial list would silently drop legs, detach tasks, or delete
  crew members.
- **The live socket sends its token as a subprotocol.**
  `new WebSocket(url, ["rally-bearer", idToken])` — a browser can set no header
  on a handshake, and a query-string token would land in the backend's request
  log and the browser's history. `useEventSocket` reconnects with backoff and
  calls `onReconnect` so the page can refetch its snapshot; the hub keeps no
  history, so anything broadcast while the socket was down is gone.
- **`useAsgardeo()` returns a new `getIdToken` every render.** Anything holding
  it in an effect dependency array rebuilds on each render — for the socket that
  was a reconnect storm. Keep it in a ref, synced in an effect (never during
  render; the lint rule enforces that).
- **The CSV export is a `fetch`, not a link.** The endpoint needs the bearer
  token, and a browser-initiated navigation (`<a href>`, `window.open`) would
  arrive unauthenticated. It goes through `useAuthApiClient` and reaches the
  browser as a blob via `utils/csv.ts`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Redirected to "invalid organization" | `config.js` still has placeholder Asgardeo values — see the section above. |
| `Api Config Error: Missing RALLY_BACKEND_BASE_URL` | `public/config.js` does not exist, or the key is absent. |
| Every request fails with a CORS error | `CORS_ALLOW_ORIGIN` is not set to `http://localhost:3000` in the backend, or the backend is not running. |
| Blank page, console shows an Asgardeo error | The redirect URL registered in Asgardeo does not exactly match `RALLY_ASGARDEO_SIGN_IN_REDIRECT_URL`. |
| Signed in, but every page shows "Organizer access required" | The backend returned 401/403 from `GET /users/me`. Check the backend logs and that the token reaches it. |
