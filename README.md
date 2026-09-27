# EasyTube

> **Your media. Your formats. Your flow.**

EasyTube is a production-grade MERN media processing and download web application. It analyses a
media URL, presents only the formats a provider actually offers, and processes them through a
queued, observable pipeline that delivers a temporary signed link.

> **Only download content you own or have permission to download.** EasyTube is built around a
> provider-adapter architecture that consumes official APIs and permitted direct-media URLs. It does
> not bypass DRM, paywalls, authentication, private content, rate limits, CAPTCHAs or any other
> platform protection, and it ships no evasion techniques of any kind.

---

## Status

| Phase  | Scope                                                              | State        |
| ------ | ------------------------------------------------------------------ | ------------ |
| **1**  | **Monorepo, toolchain, env config, health endpoint, client shell** | **Complete** |
| **2**  | **Backend architecture (config, db, redis, queue bootstrapping)**  | **Complete** |
| 3      | MongoDB models                                                     | **Complete** |
| **4**  | **Authentication (JWT + refresh rotation)**                        | **Complete** |
| 5      | Provider abstraction                                               | Pending      |
| 6      | Media analysis API                                                 | Pending      |
| 7      | Redis + BullMQ                                                     | Pending      |
| 8      | FFmpeg processing service                                          | Pending      |
| 9      | Download manager + live progress                                   | Pending      |
| 10     | React UI                                                           | Pending      |
| **11** | **Authentication UI**                                              | **Complete** |
| 12     | History                                                            | Pending      |
| 13     | Admin dashboard                                                    | Pending      |
| 14     | Security hardening + rate limiting                                 | Pending      |
| 15     | Testing expansion                                                  | Pending      |
| 16     | Docker (app images)                                                | Pending      |
| 17     | Production deployment                                              | Pending      |

**What exists today:** a running Express + TypeScript API with a validated environment, structured
logging, correlation IDs, a centralised error handler, separate liveness (`GET /api/v1/health`) and
readiness (`GET /api/v1/health/ready`) endpoints, and injectable MongoDB/Redis connection managers
with retry and credential-redaction behaviour; the full user, refresh-session and audit-log schema
layer with explicit index management; a working authentication API — registration, sign-in,
single-use rotating refresh tokens with reuse detection, account lockout, password change, and
per-device session revocation — behind Argon2id hashing and double-submit CSRF protection; and a React
client that registers, signs in, keeps the session alive across reloads, and manages devices and
password from an account screen.

---

## Tech stack

**Frontend** — React 19, Vite 6, TypeScript, Tailwind CSS v4, Framer Motion, React Router 7, Axios,
Lucide React, React Hook Form, Zod, Vitest + Testing Library.

**Backend** — Node.js, Express, TypeScript, Mongoose, MongoDB, Redis, BullMQ, FFmpeg, Pino, Zod,
Vitest + Supertest.

**Infrastructure** — MongoDB Atlas, Upstash/managed Redis, S3-compatible object storage, Vercel or
Netlify (frontend), Render / Railway / Fly.io / VPS (backend), Docker Compose (local).

---

## Architecture

```
easytube/
├── client/                     React + Vite SPA
│   ├── src/
│   │   ├── components/        brand, layout, system, ui primitives
│   │   ├── config/            validated client env
│   │   ├── hooks/             useApiHealth, ...
│   │   ├── lib/               api client, transport error, formatters
│   │   ├── pages/             HomePage, NotFoundPage
│   │   ├── test/              vitest setup
│   │   ├── types/             API envelope types
│   │   ├── App.tsx            route table
│   │   ├── main.tsx           browser entrypoint
│   │   └── index.css          Tailwind v4 theme + base layer
│   ├── index.html
│   ├── vite.config.ts         plugins, dev proxy, vitest config
│   └── .env.example
├── server/                     Express + TypeScript API
│   ├── src/
│   │   ├── config/            env (Zod), logger (Pino), constants, database, redis
│   │   ├── controllers/       health.controller.ts
│   │   ├── middleware/        requestId, cors, validate, notFound, errorHandler
│   │   ├── routes/            v1 router table, health.routes.ts
services/          health.service.ts (readiness probes)
│   │   ├── test/              vitest setup + supertest suites
│   │   ├── types/             API envelope types, Express augmentation
│   │   ├── utils/             ApiError, asyncHandler, respond helpers
│   │   ├── app.ts             createApp({ probes }) factory
│   │   └── bootstrap.ts       dependency init, timeouts, ordered shutdown
server.ts          thin process entrypoint
│   ├── tsconfig.json          typecheck config (includes tests)
│   ├── tsconfig.build.json    emit config (excludes tests)
│   ├── vitest.config.ts
│   └── .env.example
├── docker-compose.yml         MongoDB + Redis
├── package.json               npm workspaces root
└── .prettierrc.json
```

**Layering rule:** `routes -> controllers -> services -> providers`. Controllers never talk to
Mongoose, Redis or FFmpeg directly, and provider logic never leaks into controllers. That keeps the
provider abstraction (Phase 5) additive.

**Dependency injection without a container.** `createDatabaseManager` and `createRedisManager` accept
the driver as a parameter and are typed against narrow structural interfaces (`MongooseLike`,
`RedisLike`) rather than the concrete driver types. The same pattern is used one level up: `app.ts`
takes its readiness probes as an argument, and `bootstrap.ts` takes its connection managers as an
argument. That is what lets the whole suite run without a database, and it will keep BullMQ and the
Phase 3 models testable for the same reason.

**API envelope.** Every JSON response uses one of two shapes, so the client can narrow on `success`:

```jsonc
// success
{ "success": true, "message": "EasyTube API is running", "data": {}, "requestId": "..." }

// failure
{ "success": false, "message": "Route GET /x does not exist.", "error": { "code": "NOT_FOUND" }, "requestId": "..." }
```

---

## Getting started

### Prerequisites

- Node.js **>= 20.11** (developed on 24.x)
- npm 10+
- Docker Desktop (optional — only for MongoDB/Redis)

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
# Windows
copy server\.env.example server\.env
copy client\.env.example client\.env

# macOS / Linux
cp server/.env.example server/.env
cp client/.env.example client/.env
```

The server ships development-safe defaults, so it boots with **no** `.env` at all. Creating one is
only required to change ports, origins, database URIs or secrets.

Generate real secrets before deploying anywhere:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Datastores (optional in Phase 1)

```bash
docker compose up -d        # MongoDB on 27017, Redis on 6379
```

Nothing in Phase 1 connects to either yet, so this step is optional.

Since Phase 2 the API _does_ connect to both, but it still starts without them:
`REQUIRE_DATABASES_ON_BOOT=false` lets boot continue while `/api/v1/health/ready` reports `503`, so
you can work on the UI without Docker running. Flip it to `true` (or run in production) when you
want a hard failure at startup instead.

### 4. Run

```bash
npm run dev
```

- Client → http://localhost:5173
- API → http://localhost:5000/api/v1

Or run them separately:

```bash
npm run dev:server
npm run dev:client
```

In development the Vite dev server proxies `/api` to the API, so the browser stays on a single
origin and cookie/CORS behaviour matches production.

---

## Commands

Run from the repository root:

| Command                 | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `npm run dev`           | Run API + client together                                |
| `npm run dev:server`    | API only, with watch + reload                            |
| `npm run dev:client`    | Client only                                              |
| `npm run build`         | Typecheck and build both workspaces                      |
| `npm start`             | Run the compiled API                                     |
| `npm run preview`       | Serve the built client                                   |
| `npm run lint`          | ESLint across both workspaces                            |
| `npm run lint:fix`      | ESLint with autofix                                      |
| `npm run format`        | Prettier write                                           |
| `npm run format:check`  | Prettier check                                           |
| `npm run typecheck`     | `tsc --noEmit` in both workspaces                        |
| `npm test`              | Full test suite (server + client)                        |
| `npm run test:watch`    | Server tests in watch mode                               |
| `npm run test:coverage` | Coverage report (`<workspace>/coverage`)                 |
| `npm run infra:up`      | Start MongoDB + Redis                                    |
| `npm run infra:down`    | Stop the Compose stack                                   |
| `npm run verify`        | `format:check` → `lint` → `typecheck` → `test` → `build` |

---

## API

Base path: `/api/v1`

### `GET /api/v1/health`

Liveness probe. Public. Answers only for the process itself, so a brief datastore outage never causes
an orchestrator to restart a healthy API.

```bash
curl http://localhost:5000/api/v1/health
```

```json
{
  "success": true,
  "message": "EasyTube API is running",
  "data": {
    "status": "ok",
    "service": "easytube-api",
    "version": "0.1.0",
    "environment": "development",
    "uptimeSeconds": 42,
    "timestamp": "2026-01-01T00:00:00.000Z"
  },
  "requestId": "0f2b6a1c-6d1e-4a1f-9f0a-2f9a5b7c1d33"
}
```

### `GET /api/v1/health/ready`

Readiness probe. Public. Reports per-dependency state and returns `503` when the API cannot serve
traffic, so a load balancer stops sending it requests while the process stays up.

```bash
curl -i http://localhost:5000/api/v1/health/ready
```

```json
{
  "success": true,
  "message": "EasyTube API is ready",
  "data": {
    "status": "ready",
    "service": "easytube-api",
    "version": "0.1.0",
    "environment": "development",
    "timestamp": "2026-01-01T00:00:00.000Z",
    "checks": {
      "database": { "status": "up", "latencyMs": 0.42, "detail": "mongodb connected" },
      "redis": { "status": "up", "latencyMs": 0.18, "detail": "redis ready" }
    }
  },
  "requestId": "0f2b6a1c-6d1e-4a1f-9f0a-2f9a5b7c1d33"
}
```

When a dependency is down the response is a `503` failure envelope instead:

```json
{
  "success": false,
  "message": "EasyTube API is not ready.",
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "statusCode": 503,
    "message": "EasyTube API is not ready.",
    "details": {
      "status": "degraded",
      "checks": {
        "database": { "status": "up", "latencyMs": 0.42, "detail": "mongodb connected" },
        "redis": { "status": "down", "latencyMs": null, "detail": "redis wait" }
      }
    }
  },
  "requestId": "0f2b6a1c-6d1e-4a1f-9f0a-2f9a5b7c1d33"
}
```

### `GET /`

Service banner pointing at the health route.

### `POST /api/v1/auth/register` · `POST /api/v1/auth/login`

```jsonc
// request
{ "email": "user@example.com", "password": "CorrectHorseBattery9", "displayName": "Test User" }

// 201 / 200
{
  "data": {
    "user": { "id": "…", "email": "user@example.com", "role": "USER", "status": "ACTIVE" },
    "accessToken": "eyJ…",   // short-lived, kept in memory by the client
    "csrfToken": "9f2c…",    // echo in X-CSRF-Token on cookie-authenticated calls
    "expiresIn": 900
  }
}
```

The refresh token is **not** in the body. It is set as the `easytube_rt` httpOnly cookie, and only a
SHA-256 digest of it is stored, so a database dump yields no usable sessions.

`login` needs no `displayName`. Both return `401` with one identical message for every failure — a
wrong password, an unknown address and a locked account are indistinguishable, so the endpoint is not
an account-existence oracle. `register` is the exception and answers `409` for a taken address.

### `POST /api/v1/auth/refresh`

Rotates the refresh token. The one in the cookie is single-use: redeeming it writes a replacement in
the same `family` and marks the original spent. Presenting a spent token is treated as theft and
revokes the whole family, so a stolen token buys the attacker nothing and locks the real user out to
be re-authenticated. Responds `200` with a new pair, or `401`.

### Other auth routes

| Method   | Route                              | Auth           | Notes                                                         |
| -------- | ---------------------------------- | -------------- | ------------------------------------------------------------- |
| `GET`    | `/api/v1/auth/me`                  | access token   | Current user; never includes the password hash                |
| `POST`   | `/api/v1/auth/logout`              | refresh cookie | Revokes this session; idempotent                              |
| `POST`   | `/api/v1/auth/logout-all`          | access token   | Ends every session, reporting how many                        |
| `POST`   | `/api/v1/auth/change-password`     | access token   | Ends other sessions, issues a fresh one                       |
| `GET`    | `/api/v1/auth/sessions`            | access token   | Active devices, no token material                             |
| `DELETE` | `/api/v1/auth/sessions/:sessionId` | access token   | Revokes one device; also clears the cookie if it was this one |

### CSRF

Any unsafe method (`POST`, `PUT`, `PATCH`, `DELETE`) that arrives carrying the refresh cookie must
also send the CSRF token in `X-CSRF-Token`, matching the readable `easytube_csrf` cookie. The server
sets both and returns the token in the response body. Requests authenticated purely by a bearer token
are exempt: a cross-site form cannot set an `Authorization` header, so there is nothing to forge.
`X-CSRF-Token` is an allowed CORS header.

### Response headers

| Header          | Purpose                                               |
| --------------- | ----------------------------------------------------- |
| `x-request-id`  | Correlation id. Echoed from the request when supplied |
| `x-ratelimit-*` | Added in Phase 14                                     |
| `retry-after`   | Added in Phase 14                                     |

### Planned surface

`/media` · `/downloads` · `/history` · `/users` · `/admin` — mounted incrementally in
`server/src/routes/index.ts`. `/auth` is mounted and described above.

---

## Client screens

| Route       | Screen         | Notes                                                            |
| ----------- | -------------- | ---------------------------------------------------------------- |
| `/`         | Home           | Landing page plus the live API status card.                      |
| `/login`    | Sign in        | Redirects to `/account` when already signed in.                  |
| `/register` | Create account | Client-side password policy, checked before the request is sent. |
| `/account`  | Your account   | Profile, active sessions, password change. Requires a session.   |
| `*`         | Not found      | —                                                                |

**How the session is held.** The access token lives in memory only
(`client/src/lib/sessionStore.ts`) and is never written to `localStorage` or `sessionStorage`:
web storage is readable by any script on the page, which is the exposure `httpOnly` cookies exist to
prevent. The durable credential is the `easytube_rt` cookie, so a page load starts anonymous and
`AuthProvider` redeems that cookie once on startup. A `401` on any later request triggers one silent
refresh and replays the request.

That refresh is deliberately **single-flight**. Refresh tokens are single-use, and the server treats
a second redemption of the same token as replay and revokes the whole family — so several parallel
requests failing at once must not each try to redeem it.

**CSRF.** Unsafe requests get `X-CSRF-Token` automatically, from the in-memory copy of the last
auth response or, failing that, the readable `easytube_csrf` cookie.

> **Deployment constraint.** Reading the CSRF cookie from script only works when the client and API
> share an origin — the Vite dev proxy, or a host that rewrites `/api` to the API. On a split-host
> setup the cookie belongs to the API's domain, so the in-memory copy is used and a reload cannot
> silently restore a session. Prefer a same-origin or same-registrable-domain deployment.

---

## Environment variables

Full annotated lists live in [`server/.env.example`](server/.env.example) and
[`client/.env.example`](client/.env.example).

### Server (selected)

| Variable                        | Default                              | Notes                                         |
| ------------------------------- | ------------------------------------ | --------------------------------------------- |
| `NODE_ENV`                      | `development`                        | `production` enables strict secret validation |
| `PORT`                          | `5000`                               |                                               |
| `API_PREFIX`                    | `/api/v1`                            |                                               |
| `LOG_LEVEL`                     | `info`                               | `silent` in tests                             |
| `TRUST_PROXY_HOPS`              | `0`                                  | Set to `1` behind Render/Railway/Fly          |
| `CLIENT_URL`                    | `http://localhost:5173`              | Primary allowed CORS origin                   |
| `CORS_ORIGINS`                  | _(empty)_                            | Comma-separated extra origins                 |
| `MONGODB_URI`                   | `mongodb://127.0.0.1:27017/easytube` |                                               |
| `MONGO_CONNECT_RETRIES`         | `3`                                  | Retries after the first attempt               |
| `MONGO_RETRY_BASE_DELAY_MS`     | `1000`                               | Linear backoff: `base × attempt`              |
| `REDIS_URL`                     | `redis://127.0.0.1:6379`             |                                               |
| `REDIS_KEY_PREFIX`              | `easytube:`                          | Namespaces keys on a shared instance          |
| `REDIS_MAX_RETRIES_PER_REQUEST` | _(null)_                             | Must stay null for BullMQ (Phase 7)           |
| `REQUIRE_DATABASES_ON_BOOT`     | `false`                              | **Must be `true` in production.**             |
| `JWT_ACCESS_SECRET`             | dev placeholder                      | **>= 32 chars. Rejected in production.**      |
| `JWT_REFRESH_SECRET`            | dev placeholder                      | **Must differ from the access secret.**       |
| `STORAGE_DRIVER`                | `local`                              | `s3` for object storage                       |
| `SIGNED_URL_TTL_MINUTES`        | `60`                                 | Download link lifetime                        |
| `TEMP_DIR`                      | `tmp`                                | Scratch space, gitignored                     |
| `FFMPEG_PATH`                   | `ffmpeg`                             | Must be on `PATH` from Phase 8                |

Boot fails fast with a readable list of problems if the configuration is invalid, so a
half-configured process never starts.

### Client

| Variable                       | Default                 | Notes                                            |
| ------------------------------ | ----------------------- | ------------------------------------------------ |
| `VITE_API_BASE_URL`            | `/api/v1`               | Relative in dev and on Vercel; absolute if split |
| `VITE_API_TIMEOUT_MS`          | `15000`                 |                                                  |
| `VITE_HEALTH_POLL_INTERVAL_MS` | `30000`                 |                                                  |
| `VITE_DEV_API_PROXY`           | `http://localhost:5000` | Dev-server proxy target only                     |

Only `VITE_*` variables reach the browser. Never place a secret in the client.

---

## Testing

```bash
npm test                                  # everything
npm test --workspace server               # API
npm test --workspace client               # UI
npm run test:coverage --workspace server
npm run test:integration                  # needs MongoDB + Redis
```

The default suite is hermetic: no test touches the network. The datastore managers are driven through
fakes that implement the same structural interfaces as the real drivers.

Coverage by phase:

- **Phase 1** — health route contract, correlation IDs, security headers, structured 404/400
  responses, the CORS allowlist, the client brand render, the live connection indicator, its offline
  state, the 404 page and the formatting helpers.
- **Phase 2** — MongoDB and Redis lifecycle managers (settings, ready-state mapping, retry and
  backoff, credential redaction, idempotent connect/disconnect), the readiness probe aggregation
  (concurrency, latency measurement, thrown-probe handling), liveness/readiness route behaviour
  including the degraded `503`, the Zod `validate` middleware (coercion, per-section field errors),
  the response helpers, and bootstrap timeouts plus ordered shutdown.
- **Phase 3** — model schema contracts (collection names, index declarations, `select: false`
  secrets, JSON transforms), pagination clamping, the soft-delete scopes, the request/response
  schemas including SSRF-relevant URL rules, and — against a real mongod — unique, partial, text
  and TTL index enforcement, soft-delete/restore, pagination totals and scope filtering, idempotency
  keys, and index reconciliation.
- **Phase 4** — Argon2id hashing (pepper support, transparent rehash, timing equalisation for
  unknown accounts, malformed-hash tolerance), JWT issuance and verification (claim validation,
  `typ` confusion, expiry, signing-algorithm and wrong-secret rejection, TTL parsing), the auth
  service (registration, lockout, rotation, replay detection and family revocation, session
  listing and revocation, password change, every path audited), and the HTTP layer end to end —
  cookies, CSRF, status codes and error envelopes, with the access token proven absent from
  responses that carry a refresh cookie. Against a real mongod: the unique email and token-hash
  indexes, the TTL declaration, the `markRotated` compare-and-set admitting exactly one of two
  simultaneous redemptions, family revocation leaving neighbouring families alone, soft-deleted
  users unreachable by id, and the full register → rotate → replay → change-password flow.

`npm run test:integration` is opt-in and skipped unless `RUN_INTEGRATION_TESTS=true`. It exercises a
real MongoDB round trip, a real Redis `PING`, the readiness report against both, the models against
real indexes, and the auth repositories and service against real documents. Start the datastores
first with `npm run infra:up`.

The integration suites point themselves at throwaway databases and drop them on the way out. They
refuse to run if pointed at `MONGODB_URI`, because they delete the database they connect to. Each
suite has its own variable and its own default — `MONGODB_DATASTORES_TEST_DB`,
`MONGODB_MODELS_TEST_DB`, `MONGODB_AUTH_TEST_DB` — with the host shared via `MONGODB_TEST_BASE`. They
must stay separate: vitest runs files in parallel, so two suites sharing a database would let one
suite's `dropDatabase()` delete another's in-flight data.

### Indexes

Indexes are created explicitly at boot rather than by Mongoose's `autoIndex`, which is off in
production: an index build on a large collection competes with live traffic, and a schema change
should be a reviewable step rather than a side effect of a deploy.

```bash
npm run db:sync-indexes            # create anything missing, drop nothing
npm run db:sync-indexes -- --drop  # also drop undeclared indexes, and replace renamed ones
```

The default path only ever adds. `--drop` is the one that removes things, and it is needed for a
renamed index: MongoDB refuses to create `users_email_unique` while an `email_1` covers the same key,
so the old one has to go first. Mongoose's own `syncIndexes()` does not do this — against a live
mongod it neither creates the new index nor drops the old one and still reports success, which is why
the reconciliation is done explicitly in `syncModelIndexes()`.

---

## Security posture (Phase 1-4 baseline)

Already implemented:

- **Helmet** security headers; `x-powered-by` disabled.
- **Strict CORS allowlist** with an explicit allowlist, credentials enabled and a tight header
  allowlist. Unknown origins receive a structured `403`.
- **Fail-fast environment validation** — the process refuses to boot on weak, missing or shared
  production secrets, on `AUTH_PEPPER` shorter than 32 characters, on `SameSite=None` without
  `COOKIE_SECURE`, or on `NODE_ENV=production` without a `TRUST_PROXY_HOPS` decision.
- **Pino redaction** of `authorization`, `cookie`, `set-cookie`, `password`, `passwordHash`, `token`
  and `refreshToken`, in headers, bodies and log payloads.
- **Request size limits** (`1mb` default) and `extended: false` URL-encoded parsing.
- **Centralised error handling** — stack traces are returned in development only and never in
  production; internal paths, JWTs, database URIs and API keys are never serialised.
- **Correlation IDs** on every request, response header and log line.
- **Graceful shutdown** with a hard timeout so deploys never hang: stop accepting connections, drain
  in flight requests, then release Redis and MongoDB in that order even if one of them fails.
- **Slow-loris guards** — `requestTimeout` 30s, `keepAliveTimeout` 65s, `headersTimeout` 66s.
- **Datastore credential redaction** — MongoDB and Redis URIs are stripped of userinfo before they
  reach a log line.
- **Boot strictness in production** — `REQUIRE_DATABASES_ON_BOOT` cannot be `false` when
  `NODE_ENV=production`, so a production deploy never starts without its datastores.
- **No secrets in the repository** — only `.env.example` files are tracked.

Phase 3 adds, at the data layer:

- **Secrets are not queryable by accident.** `passwordHash`, `tokenHash`, `MediaFormat.url` and
  `DownloadOutput.storageKey` are `select: false`, so a normal read cannot load them; a caller has to
  opt in with `.select('+field')`. Each is also stripped again by the schema's `toJSON` transform, so
  a mistake at the query layer still cannot put a signed URL or a storage path in an API response.
- **SSRF-aware URL validation.** A source URL must be `http(s)`, must carry no embedded credentials
  (`https://example.com@evil.test/` reads like one host and is another), and its host must not be
  loopback, RFC 1918, link-local — including the `169.254.169.254` cloud metadata address — CGNAT,
  multicast, or an IPv6 loopback/unique-local/link-local/mapped form, nor a name ending in
  `.localhost`, `.local`, `.internal`, `.lan` or `.home.arpa`.
  This is validation of the request only. **DNS rebinding is not covered here**: whoever performs the
  actual fetch must re-check the resolved address and pin the connection to it. That belongs to the
  download worker, and is tracked for the pipeline phase.
- **Legal basis is required data, not a comment.** `MediaItem.authorization.basis` is a required enum,
  and `SOURCE_PROVIDERS` currently contains only `direct`.
- **Strict schemas.** `strict: 'throw'` turns a misspelled field into a loud error instead of a
  silently missing value.
- **Append-only audit trail** with a retention TTL, recording actor, target, IP, user agent and
  request id.

Phase 4 adds, for credentials:

- **Argon2id with an optional pepper.** Hashing is a native module at the OWASP baseline cost, rehashes
  transparently when the cost parameters are raised, and mixes in `AUTH_PEPPER` so a stolen database is
  not enough on its own. A wrong password and an unknown address are separated by an equivalent dummy
  hash, so neither the response nor its timing reveals which it was.
- **The durable credential never reaches JavaScript.** The refresh token is an `httpOnly` cookie and the
  API returns only the short-lived access token; a refresh token appearing in a response body would
  undo every other measure here, and there is a test asserting it never does.
- **Only digests are stored.** `RefreshSession.tokenHash` holds a SHA-256 digest, so the collection
  cannot be replayed. A unique index on it makes a collision a database error rather than a silent
  overwrite.
- **Rotation with reuse detection.** A refresh token is single-use. Redemption is a compare-and-set, so
  of two simultaneous redemptions exactly one wins, and a replay revokes the entire `family` — which is
  why the row records `rotatedAt` and `replacedBy` rather than being deleted: the lineage of a stolen
  token stays inspectable.
- **The access token is checked against the database, not just its signature.** Suspending a user,
  deleting their account or changing their role takes effect on the next request instead of after the
  token expires. A `tokenVersion` claim does the same for a password change, retiring every refresh token
  the user holds in one write.
- **The password hash is not on the request path.** It is fetched only to verify a password — by email
  during sign-in, by id during a change. Identity lookups, which run on every authenticated request, use
  a projection that does not select the field at all, so it cannot leak into a log or a serialised error
  even by accident.
- **Double-submit CSRF** on every unsafe method that carries the refresh cookie, with the token rotated
  alongside the refresh token. Bearer-only requests are exempt, since a cross-site form cannot set an
  `Authorization` header.
- **Account lockout** on consecutive failures, with the counter reset by any success and the lock
  released on expiry. The lockout is per account rather than per IP: it also bounds a distributed
  guessing attempt, where the source addresses are the attacker's.
- **Security events are audited**, and an audit failure never becomes a reason to refuse the request it
  was describing.

`argon2` is a native dependency. npm may report that its install script was skipped, and it still works
from the bundled prebuild; a machine with no matching prebuild needs a source toolchain (Python and a
C++ compiler). `jsonwebtoken` is used rather than `jose` because the project is CommonJS, where `jose` is
ESM-only.

Arriving in Phase 14: Redis-backed rate limiting (analyze 30/15min, download 10/15min, auth
10/15min), HTTP parameter pollution protection, MongoDB query sanitisation, and the full input
validation surface.

**Responsible use.** EasyTube is intended for media you own or are licensed to download. Provider
adapters must use official APIs or permitted direct-media URLs, and must refuse any source that
requires circumventing a protection measure.

---

## Deployment

| Piece   | Recommendation                                                       |
| ------- | -------------------------------------------------------------------- |
| Client  | Vercel or Netlify — build `client/`, output `client/dist`            |
| API     | Render / Railway / Fly.io / VPS — build `server/`, start `npm start` |
| MongoDB | MongoDB Atlas                                                        |
| Redis   | Upstash Redis or any managed Redis (TLS)                             |
| Storage | Cloudflare R2 / AWS S3 / MinIO                                       |

Production checklist: set `NODE_ENV=production`, provide unique high-entropy `JWT_ACCESS_SECRET` and
`JWT_REFRESH_SECRET`, set a stable 32+ character `AUTH_PEPPER` per environment, set `CLIENT_URL` to
the deployed client origin, set `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=none` when the API and the
client are on different sites, set `TRUST_PROXY_HOPS=1` when behind a single proxy hop, and set
`CORS_ORIGINS` for any preview deployments. The full walkthrough lands in Phase 17.

---

## Troubleshooting

**`API Unreachable` in the UI** — the client could not reach the API. Start it with
`npm run dev:server` and confirm `http://localhost:5000/api/v1/health` responds.

**`Invalid environment configuration` on boot** — read the printed list; it names the exact
variable. `.env` is discovered by walking up from the working directory, so run the server from the
repo root or from `server/`.

**`Origin ... is not allowed by CORS policy`** — add the origin to `CLIENT_URL` or `CORS_ORIGINS`.

**`EADDRINUSE`** — change `PORT`, or stop the process holding 5000.

**401/403 on every request in development** — `NODE_ENV=production` without real secrets means the
process refused to start; set the JWT secrets or use `NODE_ENV=development`.

**403 from a POST that used to work** — the browser is sending the refresh cookie without an
`X-CSRF-Token` header. Read `csrfToken` from the last sign-in, refresh, or password-change response and
echo it on every unsafe call. Safe methods (`GET`, `HEAD`) do not need it.

**`argon2` fails to load, or npm skipped its install script** — it is a native module. The bundled
prebuild covers common platforms; otherwise a source build needs Python and a C++ compiler, and the
install script must be allowed to run.

**429 on sign-in** — the account is locked after `AUTH_MAX_FAILED_LOGINS` consecutive failures and
unlocks itself after `AUTH_LOCKOUT_MINUTES`.

**Tailwind classes not applying** — only static class strings are extracted. Never build class names
by concatenation; map full names instead.

---

## Roadmap

Phases 1–4 and 11 are complete; the status table at the top is the source of truth. Next up is the
React UI shell for the media pipeline, then the provider abstraction and media analysis API, then the
Redis/BullMQ pipeline.

Browser extension · Android app · PWA · cloud storage integration · playlists · batch processing of
authorized URLs · scheduled processing · additional permitted providers · download notifications ·
multi-language support.

---

## Licence

MIT
