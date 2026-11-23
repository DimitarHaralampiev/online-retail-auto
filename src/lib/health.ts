// Health checks (#52) for the hosting platform and uptime monitoring:
// - liveness: the process answers (no dependencies, so a database outage
//   does not make the platform restart healthy app instances);
// - readiness: the database answers within a deadline.
// Results are cached briefly so frequent probes cannot exhaust the pool.
import { database } from "./accounts";

export type CheckStatus = "ok" | "error" | "not_configured";
export type Health = {
  status: "ok" | "error";
  checks: { database: CheckStatus };
};

const TIMEOUT_MS = 2000;
const CACHE_MS = 5000;

export async function checkDatabase(
  query: () => Promise<unknown> = () => database().query("SELECT 1"),
  timeoutMs = TIMEOUT_MS,
): Promise<CheckStatus> {
  if (!process.env.DATABASE_URL) return "not_configured";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      query(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Database check timed out")),
          timeoutMs,
        );
      }),
    ]);
    return "ok";
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(
  check: () => Promise<CheckStatus> = checkDatabase,
): Promise<Health> {
  const db = await check();
  return { status: db === "ok" ? "ok" : "error", checks: { database: db } };
}

let cached: { at: number; result: Promise<Health> } | undefined;

/** checkHealth, shared by probes arriving within a few seconds. */
export function cachedHealth(now = Date.now()): Promise<Health> {
  if (!cached || now - cached.at > CACHE_MS)
    cached = { at: now, result: checkHealth() };
  return cached.result;
}
