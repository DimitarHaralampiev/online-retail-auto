// Disposable PostgreSQL databases for integration tests.
//
// Each test file calls `setupTestDatabase()` once: it creates a uniquely named
// database on the server in TEST_DATABASE_URL, applies all migrations twice
// (proving they are idempotent) and points the application's DATABASE_URL at
// it. `drop()` closes every pool and removes the database, so test files can
// run in parallel and never touch development data. Databases abandoned by
// killed runs are swept the next time a test file starts.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { after, before } from "node:test";
import pg from "pg";
import { applyMigrations } from "../../scripts/migrations.mjs";
import { closeDatabase } from "../../src/lib/accounts";

// URL.hostname keeps the brackets of IPv6 literals.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
  // pg lets query parameters override the host in the URL, which would bypass
  // the check above, so refuse them outright.
  for (const key of url.searchParams.keys())
    if (/^host(addr)?$/i.test(key))
      throw new Error(
        `TEST_DATABASE_URL must not override the host with "${key}"`,
      );
  return url;
}

function withDatabase(server: URL, name: string): string {
  const url = new URL(server);
  url.pathname = `/${name}`;
  return url.toString();
}

const TEST_DATABASE_NAME = /^auto_it_(\d+)_[0-9a-f]{8}$/;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function dropDatabase(server: URL, name: string) {
  if (!TEST_DATABASE_NAME.test(name))
    throw new Error(`Refusing to drop non-test database ${name}`);
  const admin = new pg.Client({ connectionString: server.toString() });
  await admin.connect();
  try {
    // Names match TEST_DATABASE_NAME ([a-z0-9_] only), so quoting is safe.
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

/** Drops test databases left behind by killed runs (their process is gone). */
async function sweepAbandonedDatabases(server: URL) {
  const admin = new pg.Client({ connectionString: server.toString() });
  await admin.connect();
  let names: string[];
  try {
    const result = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datname LIKE 'auto\\_it\\_%'",
    );
    names = result.rows.map((row) => row.datname);
  } finally {
    await admin.end();
  }
  for (const name of names) {
    const pid = Number(TEST_DATABASE_NAME.exec(name)?.[1]);
    if (pid && pid !== process.pid && !processAlive(pid))
      await dropDatabase(server, name).catch(() => {});
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const server = testServerUrl();
  await sweepAbandonedDatabases(server);
  const name = `auto_it_${process.pid}_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: server.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(server, name);
  let pool: pg.Pool;
  try {
    await applyMigrations(url);
    await applyMigrations(url);
    pool = new pg.Pool({ connectionString: url, max: 4 });
  } catch (error) {
    // A broken migration must not leave a database behind, and a cleanup
    // failure must not hide the migration error.
    await dropDatabase(server, name).catch(() => {});
    throw error;
  }
  return {
    name,
    url,
    pool,
    async drop() {
      try {
        await pool.end();
        await closeDatabase();
      } finally {
        await dropDatabase(server, name);
      }
    },
  };
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
