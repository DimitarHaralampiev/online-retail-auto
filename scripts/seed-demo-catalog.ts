// Loads the demo catalog into the database in DATABASE_URL (idempotent).
// Usage: npm run db:seed:demo
// Refuses to run for a non-local APP_URL unless ALLOW_DEMO_SEED=1, so demo
// products do not end up in a real shop by accident.
import pg from "pg";
import { seedDemoCatalog } from "../src/lib/catalog-seed";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
const appHost = process.env.APP_URL
  ? new URL(process.env.APP_URL).hostname
  : "localhost";
if (!LOCAL.has(appHost) && process.env.ALLOW_DEMO_SEED !== "1")
  throw new Error(
    `APP_URL points to ${appHost}. Set ALLOW_DEMO_SEED=1 to load demo products there.`,
  );

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const summary = await seedDemoCatalog(client);
    console.log(
      `Demo catalog: ${summary.products} products (${summary.insertedProducts} new), ${summary.categories} categories, ${summary.promotionLines} promotion lines.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
