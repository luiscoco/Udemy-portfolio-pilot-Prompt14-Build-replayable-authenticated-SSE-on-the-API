# PortfolioPilot: Milestone 14 — Replayable, Authenticated SSE

This learning activity adds a secure event stream to the PortfolioPilot API. Milestone 14 is
complete; the next milestone adds the browser connection manager and automatic snapshot recovery.
For the full course sequence, see the [project plan](docs/project-plan.md). For recorded check
results, see [project state](docs/project-state.md).

## 1. Purpose and Learning Goals

The prompt asks the coding agent to build `GET /api/events` using a Node.js Next.js Route Handler.
The endpoint uses **Server-Sent Events (SSE)**: an HTTP connection that stays open so the server can
send notifications to the browser. The browser's built-in `EventSource` API reads this stream.

Portfolio changes, new news, and quote updates can happen while a student is looking at the app.
A reliable stream lets the browser learn about those changes and catch up after a disconnection.
It must also prevent one user from reading another user's events.

Students learn how to:

- Authenticate a long-running connection using an existing session cookie, without URL tokens.
- Define and validate public event data instead of exposing internal server messages.
- Resume a stream using a **cursor**, a saved position in the event history.
- Recover from missing history using a **snapshot**, a fresh view of the user's current data.
- Deliver notifications through multiple API instances without losing clients on other instances.
- Bound memory use, disconnect slow clients, and clean up timers and subscriptions.
- Test replay, authorization, duplicate delivery, heartbeats, and session revocation.

PostgreSQL remains the authoritative database. Redis retains recent events for replay. The existing
**transactional outbox** stores a pending event in the same database transaction as a change; a
worker later publishes that event to Redis. This avoids committing a portfolio change without
also recording its notification.

## 2. Steps Actually Performed

### Step 1: Inspect the existing architecture

The agent read the repository contract, project state, milestone plan, and existing authentication,
outbox, Redis stream, and recovery code. Milestone 13 already supplied owner-only streams, a
shared market stream containing quote identifiers/timestamps, and an authenticated snapshot API.

Official Next.js, Better Auth, and Redis documentation and installed guides/type definitions were
checked. No dependency versions were changed.

### Step 2: Restore dependencies

The workspace initially had no `node_modules`. The installation used the existing offline cache:

```powershell
npm ci --ignore-scripts --offline --cache .npm-cache
```

Observed result: **348 packages installed**. On this computer, the NVM npm shim rejected execution,
so the installed npm CLI was invoked through Node, or `npm.cmd` was used with the installed Node
directory first in `PATH`.

### Step 3: Define public event contracts

Created `packages/contracts/src/browser-events.ts` and exported its schemas from
`packages/contracts/src/index.ts`. A **DTO** (data transfer object) is the small, defined JSON
shape sent across an application boundary. Zod checks that these outgoing DTOs have the allowed
fields and values.

Created `apps/api/lib/browser-event.ts` to project internal events into public DTOs. Projection
removes owner/audience metadata, source-event IDs, and internal entity metadata. Internal news
ingestion events are not browser events.

### Step 4: Add owner-bound replay cursors

Created `apps/api/lib/event-cursor.ts` and modified
`apps/api/app/api/events/recovery/route.ts` to add a signed `cursor` to the snapshot response.
The existing raw `streams` fields remain available, but the SSE endpoint accepts the signed cursor.

The cursor contains both user-stream and market-stream positions. An HMAC signature, a keyed
integrity check using `AUTH_SECRET`, binds those positions to the authenticated user's ID.
Possessing a cursor does not authenticate a request; the session cookie is still required.

The recovery flow captures positions **before** reading the PostgreSQL snapshot. Changes made
during recovery can then be replayed. Events already reflected in the snapshot may replay too.

### Step 5: Implement local fan-out and connection cleanup

Created these API modules:

| File | Responsibility |
| --- | --- |
| `apps/api/lib/event-hub.ts` | Independent stream reads, shared read promises, local delivery, duplicate suppression, limits |
| `apps/api/lib/event-response.ts` | SSE headers, byte queue, heartbeat comments, session checks, abort/cancel cleanup |
| `apps/api/lib/events.ts` | Process-local hub and coalesced Redis connection attempts |
| `apps/api/app/api/events/route.ts` | Authentication, query validation, cursor selection, Node.js route |

**Fan-out** means delivering an event to all relevant connected clients. Each API process reads
Redis independently. Within a process, clients at the same stream position share a read and receive
the result locally. There is no blocking Redis connection per browser.

A single competing Redis consumer group was deliberately avoided: it would give an event to just
one API instance, leaving browsers attached to other instances without that event.

`Last-Event-ID`, the header EventSource sends when reconnecting, takes precedence over the original
cursor query parameter. Invalid or unavailable history triggers `stream.reset` and an authorized
snapshot recovery flow.

### Step 6: Add tests and resolve verification problems

Created:

- `apps/api/lib/events.test.ts` — seven cursor, DTO, hub, and lifecycle tests.
- `apps/api/app/api/events/route.test.ts` — four authorization/query/reconnection tests.
- `apps/api/lib/events.integration.test.ts` — two real PostgreSQL-session and Redis tests.

An **integration test** checks components together, rather than replacing all dependencies with
test doubles. The integration suite used real session cookies and two independent hubs reading
the same Redis publications.

Initial verification found and corrected a TypeScript fixture error, missing `DATA_MODE` in route
test setup, and a slow-client fixture too small to fill the queue. Prisma also failed to update its
user-level engine cache. The existing engine was copied into the workspace with a Windows `.exe`
extension and selected using `PRISMA_SCHEMA_ENGINE_BINARY`. All five existing migrations then
applied to the new disposable `portfolio_m14_verify` database. No new migration was needed.

### Step 7: Run checks and document the design

The agent ran the build, typecheck, browser dependency boundary check, full test suite, and a live
HTTP smoke check against Next.js on port `3014`. That temporary server was stopped afterwards.

Created [ADR 0008](docs/decisions/0008-authenticated-sse-fanout.md), which records the design decision,
and [lesson 14](docs/lessons/14-replayable-authenticated-sse.md). Updated the ADR index and project
state. No dependencies, lockfile, instruction files, or milestone plan were changed.

## 3. Results Achieved

### Available behavior

- `GET /api/events` authenticates with the existing HttpOnly session cookie.
- Responses use `text/event-stream`, private/no-cache/no-store/no-transform, `Vary: Cookie`, and
  `X-Accel-Buffering: no`. These headers discourage caching and intermediary buffering or rewriting.
- Valid signed cursors resume retained events. Foreign, malformed, expired, trimmed, or changed-epoch
  cursors reset to `/api/events/recovery`. A connection without a cursor also requests a snapshot.
- Unknown query parameters, URL token parameters, and repeated cursor parameters return HTTP 400.
- Duplicate publications with the same event UUID are suppressed within a connection. A UUID is
  the event's stable identifier; the cursor instead identifies its delivery position.
- Heartbeat comments occur every 15 seconds. They keep the connection active without creating an
  application event.
- Each client has a 64 KiB queue, including reserved space for an overflow reset. Admission is
  limited to 256 clients per process and 16 per user.
- Session expiry has a timer. Current database sessions are checked every 30 seconds with a
  two-second deadline, so revoked sessions close within the documented 32-second window.
- Browser disconnection removes stream resources; it does not cancel an agent run.

### Event types

| Public event | Status in this milestone |
| --- | --- |
| `news.available` | Supported notification from the existing outbox flow |
| `quote.updated` | Supported shared quote identifier/timestamp notification |
| `portfolio.updated` | Supported owner-only change notification |
| `watchlist.updated` | Supported owner-only change notification |
| `stream.reset` | Produced when snapshot recovery is needed |
| `agent.status`, `agent.text.delta`, `agent.message.completed`, `agent.run.completed` | Public schemas defined; agent producers are future work |

An illustrative SSE heartbeat looks like this:

```text
: heartbeat

```

A reset clears the saved SSE ID and names the fixed recovery endpoint. This is an illustrative
shape; IDs, timestamps, and reasons vary:

```text
id:
event: stream.reset
data: {"id":"<event UUID>","schemaVersion":1,"occurredAt":"<UTC timestamp>","type":"stream.reset","reason":"invalid_cursor","recoveryUrl":"/api/events/recovery"}

```

### Observed verification results

| Check actually run | Observed result |
| --- | --- |
| `npm.cmd run build` | Passed across all workspaces |
| `npm.cmd run typecheck` | Passed across all workspaces |
| `npm.cmd run check:browser-boundary` | Passed; browser packages do not import server-only dependencies |
| `npm.cmd run test` with all integration prerequisites | **123 passed, zero skipped** |
| Final SSE-focused rerun | **13 passed** across three test files |
| Final API typecheck and build | Passed |

The live HTTP smoke check observed anonymous HTTP 401; Alice and Bob sign-in; signed recovery;
foreign-cursor reset; SSE headers; two publications producing one named notification; an actual
15-second heartbeat; abort; reconnection with `Last-Event-ID` despite a stale query cursor; and a
signed-out cookie being rejected. It did not test a deployed reverse proxy or native browser UI
recovery.

## 4. How to Run and Verify

The commands below are a reproduction guide. The milestone used existing local PostgreSQL on
port `5546` and Redis on `6379`; the repository's Compose setup uses PostgreSQL port `5432`.
Adjust URLs to match your services. Commands are shown for PowerShell; on other systems use `npm`
instead of `npm.cmd` and your shell's environment-variable syntax.

### Prerequisites

- Node.js `24.21.0` and npm `11.19.0`, matching the pinned project toolchain.
- PostgreSQL and Redis reachable locally; Docker/Compose is optional if these services already run.
- A SQL client such as `psql` for creating disposable test databases.
- No AI, market-provider, or Azure credentials are needed for mock mode.

Run commands from the repository root:

```powershell
node --version
npm.cmd --version
npm.cmd ci --ignore-scripts
```

If you have the repository's complete offline cache, the installation command used during the
activity was `npm ci --ignore-scripts --offline --cache .npm-cache`.

### Start services and configure the local app

If you need the repository's Docker services, run the following. This is a setup option, not a
claim that Docker startup was reverified in milestone 14:

```powershell
npm.cmd run infra:start
npm.cmd run infra:status
```

Set server variables in the terminal that will run the API. The example credentials below are
public, local-development values only. `AUTH_SECRET` must stay on the server and match across API
instances; never put it in a `VITE_*` variable or EventSource URL.

```powershell
$env:NODE_ENV='development'
$env:DATA_MODE='mock'
$env:AGENT_MODE='mock'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/portfolio_pilot'
$env:REDIS_URL='redis://127.0.0.1:6379'
$env:DEMO_AUTH_ENABLED='true'
$env:AUTH_BASE_URL='http://localhost:5173'
$env:AUTH_SECRET='local-student-demo-only-change-me-1234567890'
$env:ALLOW_DEMO_SEED='true'

npm.cmd run build
npm.cmd run migrate:deploy --workspace=@portfolio-pilot/db
npm.cmd run seed:demo --workspace=@portfolio-pilot/db
npm.cmd run dev
```

The seed requires `NODE_ENV=development` or `test`, `ALLOW_DEMO_SEED=true`, and a loopback database
URL. The API/web development command starts the API on `3001` and web on `5173`; it does **not**
start the outbox worker. The Vite web server forwards `/api` requests to the API, keeping browser
requests on one origin.

### Open the stream and trigger a notification

Open `http://localhost:5173`, sign in as Alice Demo, and run this in the browser's developer console:

```javascript
const response = await fetch('/api/events/recovery');
if (!response.ok) throw new Error('Sign in and check the API connection.');
const snapshot = await response.json();
if (!snapshot.cursor) throw new Error('Redis is unavailable; retry recovery later.');

const stream = new EventSource('/api/events?cursor=' + encodeURIComponent(snapshot.cursor));
for (const type of ['news.available', 'quote.updated', 'portfolio.updated', 'watchlist.updated']) {
  stream.addEventListener(type, event => {
    console.log(type, event.lastEventId, JSON.parse(event.data));
  });
}
stream.addEventListener('stream.reset', event => {
  console.log('Fetch a fresh authorized snapshot:', JSON.parse(event.data));
  stream.close();
});
```

Rename one of Alice's portfolios using the UI. In a second PowerShell terminal, set the **same**
database and Redis URLs and dispatch the outbox once:

```powershell
$env:DATA_MODE='mock'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/portfolio_pilot'
$env:REDIS_URL='redis://127.0.0.1:6379'
$env:WORKER_ROLE='outbox'
$env:WORKER_ONCE='true'
npm.cmd run start --workspace=@portfolio-pilot/worker
```

The worker reads its process environment; its `.env.example` is a reference, not an automatically
loaded configuration file. Expected result: the console receives `portfolio.updated`. This UI
sequence is a guided demo; the observed milestone HTTP smoke used direct Redis publications.
The stream does not yet update the UI's cached data automatically.

Use the Network panel to inspect heartbeat comments. Run `stream.close()` when finished. A request
to `/api/events` without a cursor should return `stream.reset`; Alice's signed cursor used with
Bob's session should also reset, using Bob's authorized recovery flow.

### Run the focused SSE tests

The 11 unit/route tests do not need running database services:

```powershell
$env:DATA_MODE='mock'
npm.cmd run test --workspace=@portfolio-pilot/api -- lib/events.test.ts app/api/events/route.test.ts
```

For both additional integration tests, create and migrate the dedicated database. The tests
refuse a different database name or a non-loopback host. This example uses Compose's port `5432`:

```powershell
psql 'postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/postgres' -c 'CREATE DATABASE portfolio_m14_verify;'
$env:DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5432/portfolio_m14_verify'
npm.cmd run migrate:deploy --workspace=@portfolio-pilot/db
$env:SSE_TEST_DATABASE_URL=$env:DATABASE_URL
$env:SSE_TEST_REDIS_URL='redis://127.0.0.1:6379/14'
$env:DATA_MODE='mock'
npm.cmd run test --workspace=@portfolio-pilot/api -- lib/events.test.ts app/api/events/route.test.ts lib/events.integration.test.ts
```

Skip database creation if it already exists. Use the dedicated database because the tests seed
demo records. Expected summary, also observed during the final milestone rerun:

```text
Test Files  3 passed (3)
     Tests  13 passed (13)
```

### Run broader checks

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd run check:browser-boundary
npm.cmd run test
```

To reproduce the full **123-test, zero-skipped** result, the earlier dedicated acceptance databases
must also exist with all migrations applied. Seed `portfolio_m07_auth_verify` and
`portfolio_m08_verify` with the demo catalog/users. Use the same migration and seed commands above,
setting `DATABASE_URL` to each database in turn; keep `NODE_ENV=development` and
`ALLOW_DEMO_SEED=true`. The full milestone run reused these previously prepared databases rather
than recreating them. Configure all of these variables before the test command. These are the URLs
actually used in milestone verification; change port `5546` if your PostgreSQL uses another port:

```powershell
$env:AUTH_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m07_auth_verify'
$env:PORTFOLIO_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m08_verify'
$env:INGESTION_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m12_verify'
$env:OUTBOX_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m13_verify'
$env:OUTBOX_TEST_REDIS_URL='redis://127.0.0.1:6379/13'
$env:SSE_TEST_DATABASE_URL='postgresql://portfolio_local:local_only_change_me@127.0.0.1:5546/portfolio_m14_verify'
$env:SSE_TEST_REDIS_URL='redis://127.0.0.1:6379/14'
$env:DATA_MODE='mock'
npm.cmd run test
```

Earlier [lesson notes](docs/lessons/) explain the corresponding database suites. Without the
required variables, integration tests are skipped; that is not the same as a zero-skipped run.

## 5. Limitations, Failed Attempts, and Future Work

- **Frontend recovery is unfinished:** milestone 15 adds shared connections, cache updates,
  connection status, UUID deduplication across reconnects, and automatic snapshot recovery.
- **Agent events are contracts only:** authorized agent event producers arrive in milestones 18–19.
  This activity does not stream SDK messages or hidden reasoning.
- **Deployment was not tested:** two independent hubs were tested with real Redis, but no two-pod
  HTTP deployment, reverse-proxy buffering/failover, Azure release, or cloud provisioning occurred.
- **Polling has latency:** the API polls every 500 ms after the previous read. Providers may also
  poll or supply delayed data. Heartbeats indicate transport activity, not fresh market prices.
- **Reconnection can repeat events:** the server remembers up to 2,000 UUIDs within a connection;
  browser consumers still need deduplication across reconnections and snapshots.
- **Revocation is periodic:** an established connection can remain open for up to 32 seconds after
  revocation. A Redis deadline releases subscribers but does not cancel a command already sent.
- **Scaling needs measurement:** clients at different replay positions can require separate reads.
  The fixed admission limits bound this work; load testing is later work.
- **Initial tooling failures were resolved:** npm shim trust checks and Prisma cache permissions
  blocked early commands. The exact local workaround is recorded in project state; the final
  required local checks passed. Do not copy another computer's engine path into your setup.
- **Existing build warnings remain:** Vite emitted module directive warnings, and Next.js emitted
  three instrumentation warnings about Node APIs and the Edge runtime. The SSE route itself uses
  the Node runtime.
- **Live services were not verified here:** no live AI/provider/Entra/Azure checks or browser UI
  recovery tests were run for milestone 14. No code was committed, pushed, or publicly deployed.

## Further Reading

- [Project contract](AGENTS.md) — architecture and implementation rules.
- [Project state](docs/project-state.md) — actual results and remaining work.
- [Milestone 14 lesson](docs/lessons/14-replayable-authenticated-sse.md) — stream protocol walkthrough.
- [ADR 0008](docs/decisions/0008-authenticated-sse-fanout.md) — cursor, fan-out, and resource decisions.
- [Version notes](docs/versions.md) — pinned tools and compatibility decisions.
