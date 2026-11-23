// Starts the shop for the database-backed browser tests:
//   node --import tsx e2e-db/serve.ts <port>
// Creates a disposable database (same rules as the integration tests: local
// servers only, dropped at the end, abandoned ones swept), fills it with the
// demo catalog and fictional vehicles, orders, returns and reviews, then
// builds and serves the app against it.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import type pg from "pg";
import { closeDatabase } from "../src/lib/accounts";
import { saveFitment } from "../src/lib/admin-fitments";
import { seedDemoCatalog } from "../src/lib/catalog-seed";
import { changeOrderStatus, createOrder } from "../src/lib/orders";
import { tokenHash } from "../src/lib/password";
import { processReturn, requestReturn } from "../src/lib/returns";
import { reviewSchema, submitReview } from "../src/lib/reviews";
import { importVehicles } from "../src/lib/vehicle-import";
import { selectionCookieValue } from "../src/lib/vehicle-selection";
import {
  createTestDatabase,
  insertCustomer,
} from "../tests/integration/database";
import { FIXTURES_FILE, type Fixtures } from "./fixtures";

const port = process.argv[2] ?? "3101";

// Nothing from .env.local: no real credentials or external services.
const appEnv: Record<string, string> = {
  CATALOG_SOURCE: "postgres",
  COURIER_OFFICES_MODE: "demo",
  ORDERS_MODE: "test",
  TEST_SHIPPING_CENTS: "500",
  FREE_SHIPPING_ABOVE_CENTS: "3000",
  APP_URL: `http://localhost:${port}`,
  ORDER_TRACKING_SECRET: randomBytes(32).toString("hex"),
  PAYMENT_PROVIDER: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  SMTP_HOST: "",
  OPENAI_API_KEY: "",
  SPEEDY_API_USER: "",
  SPEEDY_API_PASSWORD: "",
  SENTRY_DSN: "",
  SITE_INDEXABLE: "",
  MEDIA_STORAGE: "database",
};

async function session(pool: pg.Pool, customerId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO customer_sessions SELECT $1, $2, now() + interval '1 day'",
    [tokenHash(token), customerId],
  );
  return token;
}

const PATH = [
  "received",
  "confirmed",
  "preparing",
  "ready",
  "handed_to_courier",
  "delivered",
] as const;

async function order(
  customer: string,
  admin: string,
  status: (typeof PATH)[number],
): Promise<string> {
  const created = await createOrder(
    {
      requestKey: randomUUID(),
      expectedTotalCents: 1890 + 500,
      acknowledgeTest: true,
      checkout: {
        items: [{ sku: "DEMO-003", quantity: 1 }],
        contact: {
          name: "Иван Петров",
          email: "buyer@example.test",
          phone: "0888123456",
        },
        delivery: {
          type: "address",
          courier: "speedy",
          city: "София",
          postalCode: "1000",
          street: "ул. Тестова",
          number: "1",
          details: "",
        },
        payment: "cod",
      },
    },
    customer,
  );
  for (let i = 1; i <= PATH.indexOf(status); i++)
    await changeOrderStatus(created.id, PATH[i], PATH[i - 1], admin, "TRK-1");
  return created.id;
}

async function prepare(pool: pg.Pool): Promise<Fixtures> {
  const client = await pool.connect();
  try {
    await seedDemoCatalog(client);
  } finally {
    client.release();
  }
  const admin = await insertCustomer(pool, {
    isAdmin: true,
    email: "admin@example.test",
  });
  const customer = await insertCustomer(pool, { email: "buyer@example.test" });

  // Fictional brands, vehicles and fitments.
  await pool.query(
    `UPDATE warehouse_products SET brand = CASE
       WHEN sku IN ('DEMO-001','DEMO-002') THEN 'Testbrand One'
       WHEN sku IN ('DEMO-003','DEMO-004') THEN 'Testbrand Two'
       ELSE 'Testbrand Three' END`,
  );
  await importVehicles(
    pool,
    admin,
    [
      "make;model;generation;year_from;year_to;engine;fuel",
      "Testmake;Alpha;Alpha I;2010;2016;1.6 diesel;diesel",
      "Testmake;Beta;Beta I;2012;2018;;",
    ].join("\n"),
    { apply: true },
  );
  const { generation, engine } = (
    await pool.query<{ generation: string; engine: string }>(
      `SELECT g.id AS generation, e.id AS engine FROM vehicle_generations g
       JOIN vehicle_engines e ON e.generation_id = g.id WHERE g.name = 'Alpha I'`,
    )
  ).rows[0];
  await saveFitment(pool, admin, "DEMO-003", {
    generationId: generation,
    engineId: null,
    yearFrom: null,
    yearTo: null,
    notes: "",
    source: "Test catalogue",
  });

  // Orders in different stages, an open and a received return (which owes a
  // refund), a review to moderate and an email that failed for good.
  await order(customer, admin, "received");
  await order(customer, admin, "ready");
  const returned = await order(customer, admin, "delivered");
  const received = await requestReturn(customer, returned, {
    lines: [{ lineNumber: 1, quantity: 1 }],
    reason: "Не става",
  });
  await processReturn(admin, received, { action: "approve", note: "" });
  await processReturn(admin, received, { action: "receive", note: "" });
  await requestReturn(customer, await order(customer, admin, "delivered"), {
    lines: [{ lineNumber: 1, quantity: 1 }],
    reason: "Поръчах грешен модел",
  });
  await submitReview(
    { id: customer, name: "Мария Иванова" },
    "DEMO-003",
    reviewSchema.parse({
      rating: 5,
      title: "Добър",
      body: "Пасна точно, качествен.",
    }),
  );
  await pool.query(
    `UPDATE order_email_outbox SET failed_at = now(), attempts = 10
     WHERE id = (SELECT id FROM order_email_outbox ORDER BY created_at LIMIT 1)`,
  );
  return {
    admin: await session(pool, admin),
    customer: await session(pool, customer),
    vehicle: selectionCookieValue({
      generationId: generation,
      engineId: engine,
      year: 2014,
    }),
  };
}

function run(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(process.execPath, ["node_modules/next/dist/bin/next", ...args], {
    env,
    stdio: "inherit",
  });
}
const finished = (child: ChildProcess) =>
  new Promise<number>((resolve) =>
    child.once("exit", (code) => resolve(code ?? 1)),
  );

async function main() {
  Object.assign(process.env, appEnv);
  const database = await createTestDatabase();
  let child: ChildProcess | undefined;
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      stopping = true;
      child?.kill("SIGTERM");
    });
  try {
    process.env.DATABASE_URL = database.url;
    writeFileSync(FIXTURES_FILE, JSON.stringify(await prepare(database.pool)), {
      mode: 0o600,
    });
    await closeDatabase();
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
    if (!process.env.E2E_SKIP_BUILD && !stopping) {
      child = run(["build"], env);
      const code = await finished(child);
      if (code && !stopping) throw new Error(`next build exited with ${code}`);
    }
    if (!stopping) {
      child = run(["start", "-p", port], env);
      const code = await finished(child);
      if (!stopping) throw new Error(`next start exited with ${code}`);
    }
  } finally {
    rmSync(FIXTURES_FILE, { force: true });
    await database.drop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
