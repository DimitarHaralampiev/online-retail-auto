// The background worker (#53). Production runs exactly this, continuously:
//   npm run worker            # until SIGTERM/SIGINT (finishes the running job)
//   npm run worker -- --once  # every job once, e.g. from cron or for a check
import { closeDatabase, database } from "../src/lib/accounts";
import {
  scanCustomerNotifications,
  sendCustomerEmails,
} from "../src/lib/customer-notifications";
import { sendOrderEmails } from "../src/lib/order-notifications";
import { releaseExpiredReservations } from "../src/lib/stock-reservations";
import { runJob, runWorker, type Job } from "../src/lib/worker";

const jobs: Job[] = [
  { name: "order-emails", everyMs: 15_000, run: () => sendOrderEmails(50) },
  {
    name: "release-expired-reservations",
    everyMs: 60_000,
    run: () => releaseExpiredReservations(database()),
  },
  {
    name: "customer-notification-scan",
    everyMs: 5 * 60_000,
    run: () => scanCustomerNotifications(),
  },
  {
    name: "customer-emails",
    everyMs: 60_000,
    run: () => sendCustomerEmails(50),
  },
];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
  const pool = database();
  try {
    if (process.argv.includes("--once")) {
      for (const job of jobs) await runJob(pool, job);
      return;
    }
    const stop = new AbortController();
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.once(signal, () => stop.abort());
    await runWorker(pool, jobs, { signal: stop.signal });
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
