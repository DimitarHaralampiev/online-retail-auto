// Loads the demo catalog into the database in DATABASE_URL (idempotent).
// Usage: npm run db:seed:demo
// Only local database servers outside production are allowed unless
// ALLOW_DEMO_SEED=1, so demo products do not end up in a real shop.
import pg from "pg";
import { assertDemoSeedTarget, seedDemoCatalog } from "../src/lib/catalog-seed";

async function main() {
  assertDemoSeedTarget(process.env);
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
