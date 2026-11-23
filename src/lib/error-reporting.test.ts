import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  parseDsn,
  reportError,
  scrub,
  sentryEnvelope,
} from "./error-reporting";

const DSN = "https://publickey@o123.ingest.sentry.io/4567";
afterEach(() => {
  delete process.env.SENTRY_DSN;
});

test("DSNs are parsed into the envelope endpoint", () => {
  assert.deepEqual(parseDsn(DSN), {
    endpoint: "https://o123.ingest.sentry.io/api/4567/envelope/",
    key: "publickey",
    dsn: DSN,
  });
  assert.equal(
    parseDsn("https://k@sentry.example.test/self-hosted/12")?.endpoint,
    "https://sentry.example.test/self-hosted/api/12/envelope/",
  );
  assert.equal(
    parseDsn("http://k@127.0.0.1:9999/1")?.endpoint,
    "http://127.0.0.1:9999/api/1/envelope/",
    "plain HTTP only for a local collector",
  );
  for (const bad of [
    undefined,
    "",
    "not a url",
    "http://k@host/1",
    "https://host/1",
    "https://k@host/abc",
  ])
    assert.equal(parseDsn(bad), null, String(bad));
});

test("scrub removes emails and long numbers but keeps ids and line numbers", () => {
  assert.equal(scrub("mail ana.b+x@example.co.uk now"), "mail [email] now");
  assert.equal(
    scrub("call 0888 123 456 or +359888123456"),
    "call [number] or [number]",
  );
  assert.equal(
    scrub("order 3f2a1b4c-1234-4abc-9def-1234567890ab at file.ts:120:7"),
    "order 3f2a1b4c-1234-4abc-9def-1234567890ab at file.ts:120:7",
  );
});

test("the envelope carries the error, tags and no request data", () => {
  const error = Object.assign(new Error("Lookup for ana@example.test failed"), {
    code: "57P01",
  });
  const [header, item, body] = sentryEnvelope(
    error,
    {
      label: "Order service failed",
      method: "POST",
      requestId: "req-12345678",
      route: "/api/orders",
    },
    parseDsn(DSN)!,
    new Date("2026-01-02T03:04:05Z"),
  )
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(header.dsn, DSN);
  assert.equal(header.event_id, body.event_id);
  assert.deepEqual(item, { type: "event" });
  assert.equal(body.timestamp, Date.parse("2026-01-02T03:04:05Z") / 1000);
  assert.equal(body.transaction, "/api/orders");
  assert.deepEqual(body.tags, {
    method: "POST",
    request_id: "req-12345678",
    code: "57P01",
  });
  const exception = body.exception.values[0];
  assert.equal(exception.type, "Error");
  assert.equal(exception.value, "Lookup for [email] failed");
  const frames = exception.stacktrace.frames;
  assert.ok(frames.length > 0);
  assert.match(
    frames.at(-1).filename,
    /error-reporting\.test\.ts/,
    "innermost frame last",
  );
  assert.equal(typeof frames.at(-1).lineno, "number");
  assert.equal(body.request, undefined);
  assert.equal(body.user, undefined);
});

test("a burst of the same failure is reported only a few times", async () => {
  process.env.SENTRY_DSN = DSN;
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const outage = Object.assign(new Error("down"), { code: "ECONNREFUSED" });
  const results = [];
  for (let i = 0; i < 15; i++)
    results.push(
      await reportError(outage, { label: "Burst test failed" }, fetcher),
    );
  assert.equal(results.filter(Boolean).length, 10);
  assert.equal(calls, 10);
  assert.equal(
    await reportError(
      new Error("other"),
      { label: "Another failure" },
      fetcher,
    ),
    true,
  );
});

test("reporting does nothing without a DSN and never throws", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  assert.equal(await reportError(new Error("x"), {}, fetcher), false);
  assert.equal(calls, 0);
  process.env.SENTRY_DSN = DSN;
  let request: { url?: string; init?: RequestInit } = {};
  assert.equal(
    await reportError(new Error("x"), {}, (async (
      url: string,
      init: RequestInit,
    ) => {
      request = { url, init };
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch),
    true,
  );
  assert.equal(request.url, "https://o123.ingest.sentry.io/api/4567/envelope/");
  assert.match(
    String((request.init?.headers as Record<string, string>)["X-Sentry-Auth"]),
    /sentry_key=publickey/,
  );
  assert.equal(
    await reportError(new Error("x"), {}, (async () => {
      throw new Error("offline");
    }) as typeof fetch),
    false,
  );
  assert.equal(
    await reportError(
      new Error("x"),
      {},
      (async () => new Response(null, { status: 429 })) as typeof fetch,
    ),
    false,
  );
});
