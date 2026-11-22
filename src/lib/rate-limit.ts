// In-memory fixed-window rate limiting for cheap public endpoints (search
// suggestions). Per server instance: enough to stop one client from
// hammering an instance; shared limits across instances belong to #51.

type Window = { count: number; resetAt: number };

const MAX_KEYS = 10_000;

export function createRateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, Window>();
  return {
    /** Counts one request for `key`; says whether it may proceed. */
    take(
      key: string,
      now = Date.now(),
    ): { allowed: boolean; retryAfterSeconds: number } {
      let window = windows.get(key);
      if (!window || window.resetAt <= now) {
        if (windows.size >= MAX_KEYS)
          for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
        // Still full of live windows: drop the oldest entry (Map keeps order).
        if (windows.size >= MAX_KEYS)
          windows.delete(windows.keys().next().value as string);
        window = { count: 0, resetAt: now + windowMs };
        windows.set(key, window);
      }
      window.count += 1;
      return {
        allowed: window.count <= limit,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((window.resetAt - now) / 1000),
        ),
      };
    },
    size: () => windows.size,
  };
}

/**
 * The client's address for rate limiting: the first X-Forwarded-For entry
 * (set by the reverse proxy in front of the app), then X-Real-IP. Requests
 * without either share one bucket.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}
