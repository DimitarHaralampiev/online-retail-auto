import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import { applyMigrations, migrationFiles } from "../../scripts/migrations.mjs";
import { testServerUrl, setupTestDatabase } from "./database";

const db = setupTestDatabase();

/** Columns, constraints and indexes of the public schema, in stable order. */
async function schemaFingerprint(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query<{ item: string }>(`
    SELECT 'column ' || table_name || '.' || column_name || ' ' || data_type
      || ' null=' || is_nullable || ' default=' || coalesce(column_default, '') AS item
      FROM information_schema.columns WHERE table_schema = 'public'
    UNION ALL
    SELECT 'constraint ' || conrelid::regclass || ' ' || pg_get_constraintdef(oid)
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    UNION ALL
    SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
    ORDER BY 1`);
  return result.rows.map((row) => row.item);
}

test("migrations are idempotent: re-running leaves the schema unchanged", async () => {
  const before = await schemaFingerprint(db().pool);
  await applyMigrations(db().url);
  assert.deepEqual(await schemaFingerprint(db().pool), before);
});

test("re-running migrations keeps existing rows", async () => {
  await db().pool.query(
    "INSERT INTO customers(id,email,password_hash,name,phone) VALUES(gen_random_uuid(),'keep@example.test','x','Keep','0888123456')",
  );
  await applyMigrations(db().url);
  const kept = await db().pool.query(
    "SELECT preferred_locale FROM customers WHERE email='keep@example.test'",
  );
  assert.equal(kept.rowCount, 1);
  assert.equal(kept.rows[0].preferred_locale, "bg");
});

test("every migration file is numbered and applied in order", async () => {
  const files = await migrationFiles();
  assert.ok(files.length >= 9);
  for (const file of files) assert.match(file, /^\d{3}-[a-z0-9-]+\.sql$/, file);
  assert.deepEqual(files, [...files].sort());
  const tables = await db().pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
  );
  const names = new Set(tables.rows.map((row) => row.table_name));
  for (const table of [
    "customers",
    "orders",
    "order_history",
    "order_email_outbox",
    "supplier_invoices",
    "warehouse_products",
    "warehouse_receipts",
    "product_categories",
    "product_media",
  ])
    assert.ok(names.has(table), `missing table ${table}`);
});

test("the harness refuses remote servers and host overrides", () => {
  const original = process.env.TEST_DATABASE_URL;
  const refused: [string, RegExp][] = [
    ["postgresql://user:pass@db.example.com/auto", /local server/],
    ["postgresql://user:pass@127.0.0.2/auto", /local server/],
    [
      "postgresql://u:p@localhost/auto?host=db.example.com",
      /override the host/,
    ],
    ["postgresql://u:p@localhost/auto?hostaddr=10.0.0.5", /override the host/],
    ["postgresql://u:p@localhost/auto?host=/var/run/postgresql", /override/],
  ];
  try {
    for (const [url, error] of refused) {
      process.env.TEST_DATABASE_URL = url;
      assert.throws(() => testServerUrl(), error, url);
    }
    for (const url of [
      "postgresql://u:p@localhost:5433/auto",
      "postgresql://u:p@127.0.0.1/auto?sslmode=disable",
      "postgresql://u:p@[::1]/auto",
    ]) {
      process.env.TEST_DATABASE_URL = url;
      assert.doesNotThrow(() => testServerUrl(), url);
    }
  } finally {
    if (original === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = original;
  }
});
