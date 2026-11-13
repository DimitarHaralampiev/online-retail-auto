// Releases stock held by unpaid card orders whose payment window passed and
// cancels those orders (the customer is emailed).
//   npm run orders:release-expired            # once (e.g. from cron)
//   npm run orders:release-expired -- --watch # every minute, like the workers
import pg from "pg";
import { releaseExpiredReservations } from "../src/lib/stock-reservations";

const INTERVAL_MS = 60_000;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const run = async () => {
    const released = await releaseExpiredReservations(pool);
    console.log(`Released ${released} expired reservation(s).`);
  };
  if (!process.argv.includes("--watch")) {
    try {
      await run();
    } finally {
      await pool.end();
    }
    return;
  }
  for (;;) {
    await run().catch((error) => console.error(error));
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
