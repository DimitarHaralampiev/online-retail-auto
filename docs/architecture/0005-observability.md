# ADR 0005: Observability — logs, request ids, error tracking, health

Status: accepted (2026-11-23, #52).

## Context

Before launch the shop needs to show what fails in production and where.
That means server errors with enough context to fix them, logs a hosting
platform can search, a way to link a customer's report to the log lines
of that request, and probes for the platform and uptime monitoring. Server
errors were `console.error` calls that logged only an error code, and
nothing reported them.

## Decision

### Structured logs (`src/lib/log.ts`)

- One JSON object per line: `time`, `level`, `msg`, fields. Errors go to
  stderr, everything else to stdout.
- Fields whose names look secret (password, token, secret, cookie,
  authorization, API key, DSN, credential) are redacted.
- Error messages and stacks are scrubbed of email addresses and
  phone-like or card-like numbers.
- pg error `detail` (which can contain row values) is never logged.
- `logError(message, error, fields)` is the one way to record a handled
  failure: an error the visitor got a 4xx or 5xx answer for. It logs the
  line with the request id and reports the error. It never throws.

### Request ids (`src/lib/request-id.ts`, `src/proxy.ts`)

- The proxy gives every page and API request an `x-request-id`.
- It keeps one set by a load balancer in front of the app if the value has
  a safe shape; otherwise it creates a UUID.
- The id goes to the app and back to the client in the response, so a
  support request can quote it.
- Static assets, images, media and prefetches don't get one.

### Error tracking (`src/lib/error-reporting.ts`, `src/instrumentation.ts`)

- **Sources:**
  - errors Next.js catches (`onRequestError`: rendering, route handlers,
    server actions);
  - every `logError` call.
- **Destination:** Sentry through its HTTP envelope API, when
  `SENTRY_DSN` is set.
- **What is sent:**
  - the error type, the scrubbed message and the stack frames;
  - the label and the route;
  - tags: method, route type, request id, error code and React digest;
  - the environment (`APP_ENV`) and the release (`APP_RELEASE`).
- Request headers, cookies, bodies, IP addresses and user identities are
  never sent.
- Sending has a 3-second timeout and never throws.
- Without a DSN nothing is sent.
- DSNs must use HTTPS, except for a collector on the same machine.
- **Why no SDK:**
  - the SDK instruments the browser bundle and the build;
  - it adds client JavaScript, which the performance budget in ADR 0004
    counts;
  - it needs CSP exceptions;
  - it sends request data by default.
- The envelope API covers server-side reporting in about a hundred lines.
  Adopting the SDK later stays possible if tracing or session replay is
  ever wanted.

### Health checks (`/api/health`, `src/lib/health.ts`)

| Probe     | Request                      | Answer                                                                                           |
| --------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Liveness  | `GET /api/health?probe=live` | always 200 while the process answers                                                             |
| Readiness | `GET /api/health`            | 200 with `{ status: "ok", checks: { database: "ok" } }`, or 503 with `error` or `not_configured` |

- Liveness has no dependencies, so a database outage doesn't make the
  platform restart healthy instances.
- The readiness database check is `SELECT 1` with a 2-second deadline.
  Its result is shared for 5 seconds, so frequent probes can't exhaust the
  5-connection pool.
- Neither probe reveals versions or error details. Both answers are
  `no-store`.

## Consequences

- Handled and unhandled server errors reach Sentry with the request id
  that is in the log line and the response.
- The workers in `scripts/` still write plain console output. They will
  move to `log()` with the job queue (#53).
- Browser errors and field Core Web Vitals are tracked in #117.
