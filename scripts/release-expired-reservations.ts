// Releases stock held by unpaid card orders whose payment window passed and
// cancels those orders. Run periodically (e.g. every few minutes):
// npm run orders:release-expired
import pg from "pg";
import { releaseExpiredReservations } from "../src/lib/stock-reservations";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const released = await releaseExpiredReservations(pool);
    console.log(`Released ${released} expired reservation(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
