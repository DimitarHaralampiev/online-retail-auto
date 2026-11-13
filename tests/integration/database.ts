// Disposable PostgreSQL databases for integration tests.
//
// Each test file calls `setupTestDatabase()` once: it creates a uniquely named
// database on the server in TEST_DATABASE_URL, applies all migrations twice
// (proving they are idempotent) and points the application's DATABASE_URL at
// it. `drop()` closes every pool and removes the database, so test files can
// run in parallel and never touch development data.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { after, before } from "node:test";
import pg from "pg";
import { applyMigrations } from "../../scripts/migrations.mjs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type TestDatabase = {
  name: string;
  url: string;
  pool: pg.Pool;
  drop(): Promise<void>;
};

/**
 * TEST_DATABASE_URL, or locally the server from DATABASE_URL in .env.local.
 * Only the server address is used: every test file creates its own database.
 */
function configuredServer(): string | undefined {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!existsSync(".env.local")) return undefined;
  return parseEnv(readFileSync(".env.local", "utf8")).DATABASE_URL;
}

export function testServerUrl(): URL {
  const raw = configuredServer();
  if (!raw)
    throw new Error(
      "Set TEST_DATABASE_URL (or DATABASE_URL in .env.local) to a local PostgreSQL server, for example postgresql://auto:<password>@127.0.0.1:5433/auto",
    );
  const url = new URL(raw);
  // Tests create and drop databases: never allow that against a remote server.
  if (!LOCAL_HOSTS.has(url.hostname))
    throw new Error(
      `TEST_DATABASE_URL must point to a local server, got ${url.hostname}`,
    );
  return url;
}

function withDatabase(server: URL, name: string): string {
  const url = new URL(server);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const server = testServerUrl();
  const name = `auto_it_${process.pid}_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: server.toString() });
  await admin.connect();
  try {
    // The name is generated above from [a-z0-9_] only, so quoting is safe.
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(server, name);
  await applyMigrations(url);
  await applyMigrations(url);
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  return {
    name,
    url,
    pool,
    async drop() {
      await pool.end();
      await closeApplicationPool();
      const cleanup = new pg.Client({ connectionString: server.toString() });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** The application caches its pool on globalThis (see src/lib/accounts.ts). */
async function closeApplicationPool() {
  const holder = globalThis as typeof globalThis & { accountPool?: pg.Pool };
  const pool = holder.accountPool;
  holder.accountPool = undefined;
  await pool?.end();
}

/**
 * Registers before/after hooks for the current test file and returns a getter
 * for the database. DATABASE_URL is set before any application query runs.
 */
export function setupTestDatabase(): () => TestDatabase {
  let database: TestDatabase | undefined;
  before(async () => {
    database = await createTestDatabase();
    process.env.DATABASE_URL = database.url;
  });
  after(async () => {
    await database?.drop();
  });
  return () => {
    if (!database) throw new Error("Test database is not ready yet.");
    return database;
  };
}

/** Inserts a verified customer and returns its id. */
export async function insertCustomer(
  pool: pg.Pool,
  overrides: { email?: string; isAdmin?: boolean } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO customers(id,email,password_hash,name,phone,email_verified_at,is_admin) VALUES($1,$2,'not-a-real-hash','Test Customer','0888123456',now(),$3)",
    [
      id,
      overrides.email ?? `customer-${id}@example.test`,
      overrides.isAdmin ?? false,
    ],
  );
  return id;
}
