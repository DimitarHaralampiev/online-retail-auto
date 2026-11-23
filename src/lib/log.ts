// Structured logging (#52): one JSON object per line on stdout/stderr, with
// the request id when there is one, so a hosting log service can filter and
// correlate. Fields that look like secrets are redacted and error messages
// are scrubbed of email addresses and phone or card-like numbers.
import { headers } from "next/headers";
import { reportError, scrub } from "./error-reporting";
import { REQUEST_ID_HEADER } from "./request-id";

export { REQUEST_ID_HEADER };

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const SECRET =
  /pass(word)?|token|secret|cookie|authori[sz]ation|api[-_]?key|dsn|credential/i;

function serialize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const e = value as Error & { code?: string; digest?: string };
    return {
      name: e.name,
      message: scrub(e.message),
      ...(e.code && { code: e.code }),
      ...(e.digest && { digest: e.digest }),
      ...(e.stack && {
        stack: scrub(e.stack.split("\n").slice(0, 12).join("\n")),
      }),
    };
  }
  if (value && typeof value === "object" && depth < 4) {
    if (Array.isArray(value))
      return value.slice(0, 50).map((v) => serialize(v, depth + 1));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        SECRET.test(key) ? "[redacted]" : serialize(v, depth + 1),
      ]),
    );
  }
  return value;
}

/** A log line as written (exported for tests). */
export function formatLog(
  level: LogLevel,
  message: string,
  fields: LogFields = {},
  now = new Date(),
): string {
  return JSON.stringify({
    time: now.toISOString(),
    level,
    msg: message,
    ...(serialize(fields) as LogFields),
  });
}

export function log(level: LogLevel, message: string, fields: LogFields = {}) {
  const line = formatLog(level, message, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** The current request's id (set by src/proxy.ts), outside requests none. */
export async function currentRequestId(): Promise<string | undefined> {
  try {
    return (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Logs a failure that was handled (the visitor got an error answer) and
 * reports it to error tracking. Never throws.
 */
export function logError(
  message: string,
  error: unknown,
  fields: Record<string, string | number | boolean | undefined> = {},
  report: typeof reportError = reportError,
): Promise<void> {
  return (async () => {
    const requestId = await currentRequestId();
    log("error", message, {
      ...(requestId && { requestId }),
      ...fields,
      ...(error != null && { error }),
    });
    await report(error instanceof Error ? error : new Error(message), {
      label: message,
      requestId,
      extra: fields,
    });
  })().catch(() => {});
}
