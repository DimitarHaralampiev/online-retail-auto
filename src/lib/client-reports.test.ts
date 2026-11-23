import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST } from "../app/api/client-reports/route";
import { clientReportSchema, isClientReport } from "./client-report-schema";
import {
  browserErrorsEnabled,
  createErrorFilter,
  fieldVitalsEnabled,
  MAX_ERRORS_PER_PAGE,
  reportPath,
  reportStack,
} from "./client-reports";
import { consentCategoriesInUse } from "./consent";

afterEach(() => {
  delete process.env.BROWSER_ERRORS;
  delete process.env.FIELD_VITALS;
});

let client = 0;
/** POSTs as a new client each time, so limits do not carry over. */
async function post(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string; lines: Record<string, unknown>[] }> {
  const lines: Record<string, unknown>[] = [];
  const { error, log } = console;
  console.error = console.log = (line: string) => lines.push(JSON.parse(line));
  try {
    const response = await POST(
      new Request("http://shop.test/api/client-reports", {
        method: "POST",
        headers: {
          host: "shop.test",
          origin: "http://shop.test",
          "content-type": "application/json",
          "x-forwarded-for": `10.0.0.${(client += 1)}`,
          ...headers,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    return { status: response.status, text: await response.text(), lines };
  } finally {
    Object.assign(console, { error, log });
  }
}

const report = {
  type: "error" as const,
  name: "TypeError",
  message: "x is undefined for ana@example.test +359888123456",
  stack:
    "TypeError: x\n    at f (https://shop.test/_next/a.js?dpl=1:1:2)\n    at https://shop.test/orders/1#token=abc:3:4",
  path: "/orders/3f2a1b4c-1234-4abc-9def-1234567890ab?x=1#token=secret",
};

test("paths lose queries, fragments, ids and product codes", () => {
  assert.equal(reportPath(report.path), "/orders/[id]");
  assert.equal(reportPath("/catalog/DEMO-003?lang=en"), "/catalog/[sku]");
  assert.equal(reportPath("/catalog?q=my+name"), "/catalog");
  assert.equal(
    reportPath("/newsletter/confirm#token=abc"),
    "/newsletter/confirm",
  );
  assert.doesNotMatch(reportStack(report.stack), /token|dpl/);
});

test("an error is logged once, scrubbed, without query or fragment", async () => {
  const { status, text, lines } = await post(report);
  assert.equal(status, 204);
  assert.equal(text, "");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].msg, "Browser error");
  assert.equal(lines[0].path, "/orders/[id]");
  const line = JSON.stringify(lines[0]);
  assert.match(line, /TypeError/);
  assert.match(line, /\[email\]/);
  assert.doesNotMatch(line, /ana@example|359888|secret|token/);
});

test("a vital is logged only when the shop turned it on", async () => {
  const vital = {
    type: "vital" as const,
    name: "LCP" as const,
    value: 1234.56789,
    rating: "good" as const,
    path: "/catalog?q=x",
  };
  assert.deepEqual((await post(vital)).lines, []);
  process.env.FIELD_VITALS = "1";
  const { status, lines } = await post(vital);
  assert.equal(status, 204);
  assert.deepEqual(
    { ...lines[0], time: undefined },
    {
      time: undefined,
      level: "info",
      msg: "Web vital",
      name: "LCP",
      value: 1234.568,
      rating: "good",
      path: "/catalog",
    },
  );
});

test("errors can be turned off", async () => {
  process.env.BROWSER_ERRORS = "0";
  const { status, lines } = await post(report);
  assert.equal(status, 204);
  assert.deepEqual(lines, []);
});

test("forged, oversized and malformed reports are refused quietly", async () => {
  for (const headers of [
    { origin: "https://evil.test" },
    { origin: "null" },
    { "content-type": "text/plain" },
  ] as Record<string, string>[])
    assert.equal((await post(report, headers)).status, 400);
  for (const body of [
    "not json",
    "null",
    {},
    { ...report, type: "other" },
    { ...report, path: "https://evil.test/" },
    { ...report, message: "x".repeat(1001) },
    { ...report, extra: "field" },
    { type: "vital", name: "XXX", value: 1, rating: "good", path: "/" },
    { type: "vital", name: "LCP", value: -1, rating: "good", path: "/" },
    { ...report, stack: "x".repeat(20_000) },
  ]) {
    const { status, lines } = await post(body);
    assert.equal(status, 400, JSON.stringify(body).slice(0, 80));
    assert.deepEqual(lines, []);
  }
});

test("one client cannot flood the log", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 40; i++)
    statuses.push(
      (await post(report, { "x-forwarded-for": "203.0.113.9" })).status,
    );
  assert.equal(statuses.filter((s) => s === 204).length, 30);
  assert.equal(statuses.at(-1), 429);
});

test("control characters cannot forge log lines", () => {
  const parsed = clientReportSchema.parse({
    ...report,
    message: "a\u0000b\u001b[31m\r\nlevel",
  });
  assert.doesNotMatch(
    parsed.name + (parsed as { message: string }).message,
    /[\u0000-\u0009\u000b-\u001f]/,
  );
});

test("the browser reports each error once, a few per page, with details", () => {
  const filter = createErrorFilter();
  const boom = new TypeError("boom");
  const first = filter(boom, "/cart?x=1");
  assert.ok(first && isClientReport(first));
  assert.equal(first.type === "error" && first.path, "/cart");
  assert.equal(filter(boom, "/cart"), null, "only once");
  assert.ok(filter("a rejected string", "/"), "non-errors are reported too");
  for (let i = 0; i < 20; i++) filter(new Error(`e${i}`), "/");
  assert.equal(filter(new Error("one too many"), "/"), null);
  const all = createErrorFilter();
  let sent = 0;
  for (let i = 0; i < 20; i++) if (all(new Error(`e${i}`), "/")) sent += 1;
  assert.equal(sent, MAX_ERRORS_PER_PAGE);
});

test("errors without use are not reported", () => {
  const filter = createErrorFilter();
  const extension = new Error("x");
  extension.stack = "Error: x\n    at chrome-extension://abc/content.js:1:1";
  for (const value of [
    null,
    undefined,
    new Error("Script error."),
    new DOMException("left", "AbortError"),
    Object.assign(new Error("server"), { digest: "123" }),
    extension,
  ])
    assert.equal(filter(value, "/"), null);
});

test("errors are on by default; vitals are off and ask for consent", () => {
  assert.equal(browserErrorsEnabled({}), true);
  assert.equal(browserErrorsEnabled({ BROWSER_ERRORS: "0" }), false);
  assert.equal(fieldVitalsEnabled({}), false);
  assert.deepEqual(consentCategoriesInUse({}), []);
  assert.deepEqual(consentCategoriesInUse({ FIELD_VITALS: "1" }), [
    "analytics",
  ]);
});
