// Background worker (#53): one process runs every recurring job — email
// delivery, notification scans and releasing expired stock reservations —
// on its own interval. Each job holds a PostgreSQL advisory lock while it
// runs, so extra worker instances (or a deploy overlap) never run the same
// job at the same time. Stopping waits for the running job to finish.
import type { Pool } from "pg";
import { log, logError } from "./log";

export type Job = {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
};

/**
 * Runs `fn` only if no other session holds the job's lock; returns
 * `undefined` when another worker is already running it.
 */
export async function withJobLock<T>(
  pool: Pool,
  name: string,
  fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('auto-shop-job'), hashtext($1)) AS locked",
      [name],
    );
    if (!rows[0].locked) return { ran: false };
    try {
      return { ran: true, result: await fn() };
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('auto-shop-job'), hashtext($1))",
        [name],
      );
    }
  } finally {
    client.release();
  }
}

/** Runs one job, logging its outcome; never throws. */
export async function runJob(pool: Pool, job: Job): Promise<void> {
  const started = Date.now();
  try {
    const outcome = await withJobLock(pool, job.name, job.run);
    if (!outcome.ran) {
      log("info", "Job skipped: running elsewhere", { job: job.name });
      return;
    }
    log("info", "Job finished", {
      job: job.name,
      result: outcome.result as never,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    await logError("Job failed", error, {
      job: job.name,
      durationMs: Date.now() - started,
    });
  }
}

/** Jobs whose interval has passed since their last start. */
export function dueJobs(
  jobs: readonly Job[],
  lastRun: Map<string, number>,
  now: number,
): Job[] {
  return jobs.filter(
    (job) => now - (lastRun.get(job.name) ?? -Infinity) >= job.everyMs,
  );
}

export async function runWorker(
  pool: Pool,
  jobs: readonly Job[],
  { signal, tickMs = 1000 }: { signal: AbortSignal; tickMs?: number },
): Promise<void> {
  const lastRun = new Map<string, number>();
  log("info", "Worker started", { jobs: jobs.map((j) => j.name) });
  while (!signal.aborted) {
    for (const job of dueJobs(jobs, lastRun, Date.now())) {
      if (signal.aborted) break;
      lastRun.set(job.name, Date.now());
      await runJob(pool, job);
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, tickMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  log("info", "Worker stopped");
}
