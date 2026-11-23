// Error tracking (#52): server errors are sent to Sentry when SENTRY_DSN is
// set, through Sentry's HTTP envelope API (no SDK, nothing in the browser).
// Only the error (type, scrubbed message, stack), a short label, the route
// and the request id are sent — never headers, cookies, bodies or details.
// Without a DSN this does nothing.

import { createRateLimiter } from "./rate-limit";

// During an outage every request fails the same way: report the first few
// of each kind per minute and leave the rest to the logs.
const SAME_KIND_PER_MINUTE = 10;
const ALL_PER_MINUTE = 60;
const kindLimiter = createRateLimiter(SAME_KIND_PER_MINUTE, 60_000);
const totalLimiter = createRateLimiter(ALL_PER_MINUTE, 60_000);

export type ErrorContext = {
  /** What failed, e.g. "Order service failed". */
  label?: string;
  route?: string;
  method?: string;
  requestId?: string;
  routeType?: string;
  extra?: Record<string, string | number | boolean | undefined>;
};

export type Dsn = { endpoint: string; key: string; dsn: string };

/** Removes email addresses and phone or card-like numbers from free text. */
export function scrub(text: string): string {
  return text
    .replace(/[^\s@"'<>()[\]]+@[^\s@"'<>()[\]]+\.[a-z]{2,}/gi, "[email]")
    .replace(/(?<![\w.-])\+?\d(?:[\s-]?\d){6,}(?![\w.-])/g, "[number]");
}

export function parseDsn(value: string | undefined): Dsn | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const project = parts.pop();
    if (
      // HTTPS only; plain HTTP just for a collector on this machine.
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )) ||
      !url.username ||
      !project ||
      !/^\d+$/.test(project)
    )
      return null;
    const prefix = parts.length ? `/${parts.join("/")}` : "";
    return {
      endpoint: `${url.origin}${prefix}/api/${project}/envelope/`,
      key: url.username,
      dsn: value,
    };
  } catch {
    return null;
  }
}

type Frame = {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
};

function frames(stack: string): Frame[] {
  return stack
    .split("\n")
    .slice(1, 40)
    .map((line) => {
      const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
      if (!match) return { function: line.trim().slice(0, 200) };
      return {
        ...(match[1] && { function: match[1] }),
        filename: match[2],
        lineno: Number(match[3]),
        colno: Number(match[4]),
      };
    })
    .reverse(); // Sentry lists the innermost frame last.
}

/** The envelope Sentry expects (exported for tests). */
export function sentryEnvelope(
  error: unknown,
  context: ErrorContext,
  dsn: Dsn,
  now = new Date(),
): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const extra = e as Error & { code?: string; digest?: string };
  const eventId = crypto.randomUUID().replaceAll("-", "");
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    method: context.method,
    route_type: context.routeType,
    request_id: context.requestId,
    code: extra.code,
    digest: extra.digest,
  }))
    if (value) tags[key] = String(value).slice(0, 200);
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "node",
    level: "error",
    logger: "auto-shop",
    environment: process.env.APP_ENV || process.env.NODE_ENV || "development",
    ...(process.env.APP_RELEASE && { release: process.env.APP_RELEASE }),
    ...((context.route || context.label) && {
      transaction: context.route ?? context.label,
    }),
    ...(context.label && { message: { formatted: context.label } }),
    tags,
    ...(context.extra && { extra: context.extra }),
    exception: {
      values: [
        {
          type: e.name,
          value: scrub(e.message).slice(0, 1000),
          ...(e.stack && { stacktrace: { frames: frames(e.stack) } }),
        },
      ],
    },
  };
  return [
    JSON.stringify({
      event_id: eventId,
      sent_at: now.toISOString(),
      dsn: dsn.dsn,
    }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

export async function reportError(
  error: unknown,
  context: ErrorContext,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return false;
  const kind = `${context.label ?? context.route ?? ""}|${(error as { code?: string })?.code ?? ""}`;
  if (!kindLimiter.take(kind).allowed || !totalLimiter.take("all").allowed)
    return false;
  try {
    const response = await fetcher(dsn.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=auto-shop/1.0`,
      },
      body: sentryEnvelope(error, context, dsn),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    // Reporting must never break the request or cause a loop of errors.
    return false;
  }
}
