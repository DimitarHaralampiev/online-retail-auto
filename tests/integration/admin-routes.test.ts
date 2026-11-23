// Every admin API route (#86), exercised at the handler level: anonymous
// and non-admin requests are refused, state-changing requests need this
// site's Origin, invalid input is a 400, and unexpected database errors are
// a 503 without details.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { tokenHash } from "../../src/lib/password";
import { insertCustomer, setupTestDatabase } from "./database";

const HOST = "shop.test";
const ROOT = path.resolve("src/app/api/admin");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];
type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type Route = {
  url: string;
  params: Record<string, string>;
  handlers: Partial<Record<Method, Handler>>;
};

const PARAMS: Record<string, string> = {
  id: randomUUID(),
  sku: "DEMO-001",
  kind: "make",
  slug: "terms",
};

const routes: Route[] = [];
const tokens = { admin: "", customer: "" };

async function loadRoutes() {
  for (const file of readdirSync(ROOT, { recursive: true }) as string[]) {
    if (path.basename(file) !== "route.ts") continue;
    const dir = path.dirname(file);
    const params = Object.fromEntries(
      [...dir.matchAll(/\[(\w+)\]/g)].map(([, name]) => [
        name,
        PARAMS[name] ?? "x",
      ]),
    );
    const url = `/api/admin/${dir.replace(/\[(\w+)\]/g, (_, name) => params[name])}`;
    const mod = await import(pathToFileURL(path.join(ROOT, file)).href);
    const handlers = Object.fromEntries(
      METHODS.filter((m) => typeof mod[m] === "function").map((m) => [
        m,
        mod[m],
      ]),
    );
    routes.push({ url, params, handlers });
  }
}

const db = setupTestDatabase({
  prepare: async (database) => {
    await loadRoutes();
    const session = async (isAdmin: boolean) => {
      const id = await insertCustomer(database.pool, { isAdmin });
      const token = randomBytes(32).toString("hex");
      await database.pool.query(
        "INSERT INTO customer_sessions SELECT $1, $2, now() + interval '1 day'",
        [tokenHash(token), id],
      );
      return token;
    };
    tokens.admin = await session(true);
    tokens.customer = await session(false);
  },
});

function call(
  route: Route,
  method: Method,
  options: { token?: string; origin?: string | null; body?: unknown } = {},
) {
  const headers = new Headers({ host: HOST });
  const origin =
    options.origin === undefined ? `http://${HOST}` : options.origin;
  if (origin) headers.set("origin", origin);
  if (options.token)
    headers.set("cookie", `auto_locale=bg; auto_session=${options.token}`);
  const hasBody = method !== "GET";
  if (hasBody) headers.set("content-type", "application/json");
  const request = new Request(`http://${HOST}${route.url}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(options.body ?? {}) : undefined,
  });
  return route.handlers[method]!(request, {
    params: Promise.resolve(route.params),
  });
}

/** Runs with console.error silenced (handled failures are logged). */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

type Options = Parameters<typeof call>[2];
const cases = () =>
  routes.flatMap((route) =>
    (Object.keys(route.handlers) as Method[]).map((method) => ({
      route,
      method,
      name: `${method} ${route.url}`,
    })),
  );

async function answer(route: Route, method: Method, options: Options) {
  const response = await quietly(() => call(route, method, options));
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

/** Error answers are short messages: no stacks, SQL or internals. */
function assertSafeError(name: string, body: { error?: unknown } | null) {
  assert.equal(typeof body?.error, "string", `${name}: error message`);
  assert.doesNotMatch(
    String(body!.error),
    /\bat \S+:\d+|relation|column|syntax|ECONN|SELECT|INSERT/i,
    `${name}: no internals`,
  );
}

test("every admin route was found", () => {
  assert.ok(db());
  // Guards the discovery itself: a broken glob would make the rest vacuous.
  assert.ok(cases().length >= 30, `found ${cases().length} handlers`);
  for (const expected of [
    "GET /api/admin/orders",
    "POST /api/admin/catalog/products",
    "PUT /api/admin/legal/terms",
    "PATCH /api/admin/products/media",
  ])
    assert.ok(
      cases().some((c) => c.name === expected),
      `${expected} is covered`,
    );
});

test("anonymous visitors and customers are refused", async () => {
  for (const { route, method, name } of cases()) {
    for (const token of [undefined, tokens.customer]) {
      const { status, body } = await answer(route, method, { token });
      assert.equal(
        status,
        403,
        `${name} as ${token ? "customer" : "anonymous"}`,
      );
      assertSafeError(name, body);
    }
  }
});

test("expired, malformed and unknown sessions are refused", async () => {
  const orders = cases().find((c) => c.name === "GET /api/admin/orders")!;
  const expired = randomBytes(32).toString("hex");
  await db().pool.query(
    "INSERT INTO customer_sessions SELECT $1, customer_id, now() - interval '1 second' FROM customer_sessions WHERE token_hash = $2",
    [tokenHash(expired), tokenHash(tokens.admin)],
  );
  for (const token of [expired, "not-hex", randomBytes(32).toString("hex")])
    assert.equal(
      (await answer(orders.route, orders.method, { token })).status,
      403,
    );
});

test("state-changing admin requests need this site's Origin", async () => {
  for (const { route, method, name } of cases()) {
    if (method === "GET") continue;
    for (const origin of ["https://evil.test", "null", null]) {
      const { status, body } = await answer(route, method, {
        token: tokens.admin,
        origin,
      });
      assert.equal(status, 400, `${name} with Origin ${origin}`);
      assertSafeError(name, body);
    }
  }
});

test("invalid admin input is a 400 (or 404 for unknown ids), never a 5xx", async () => {
  for (const { route, method, name } of cases()) {
    const { status, body } = await answer(route, method, {
      token: tokens.admin,
      body: { unexpected: true },
    });
    if (method === "GET") {
      assert.ok(status < 500, `${name}: ${status}`);
      continue;
    }
    assert.ok([400, 404].includes(status), `${name}: ${status}`);
    assertSafeError(name, body);
  }
  // Schema validation specifically (ZodError → 400).
  for (const [name, input] of [
    ["POST /api/admin/catalog/products", { sku: "" }],
    ["POST /api/admin/catalog/categories", { slug: "Not A Slug!" }],
    ["PUT /api/admin/legal/terms", { content: 42 }],
  ] as const) {
    const c = cases().find((x) => x.name === name)!;
    const { status } = await answer(c.route, c.method, {
      token: tokens.admin,
      body: input,
    });
    assert.equal(status, 400, name);
  }
});

test("an unexpected database error is a 503 without details", async () => {
  for (const [name, table] of [
    ["GET /api/admin/orders", "orders"],
    ["GET /api/admin/returns", "return_requests"],
    ["GET /api/admin/reviews", "product_reviews"],
  ] as const) {
    const c = cases().find((x) => x.name === name)!;
    assert.equal(
      (await answer(c.route, c.method, { token: tokens.admin })).status,
      200,
      `${name} works first`,
    );
    await db().pool.query(`ALTER TABLE ${table} RENAME TO ${table}_away`);
    try {
      const { status, body } = await answer(c.route, c.method, {
        token: tokens.admin,
      });
      assert.equal(status, 503, name);
      assertSafeError(name, body);
    } finally {
      await db().pool.query(`ALTER TABLE ${table}_away RENAME TO ${table}`);
    }
  }
});
