// Rate limits for expensive or sensitive endpoints (#51), per server
// instance (in memory; a shared store is needed once several instances run).
// Account and email limits per address live in the database (auth_attempts,
// password_resets, email_verifications); these add per-client ceilings.
import { NextResponse } from "next/server";
import { clientKey, createRateLimiter } from "./rate-limit";

/** Sign-in and registration attempts per client. */
export const authLimiter = createRateLimiter(20, 15 * 60_000);
/** Orders per client (checkout). */
export const checkoutLimiter = createRateLimiter(10, 10 * 60_000);
/** Paid AI calls per admin (invoice reading, market research, insights). */
export const aiLimiter = createRateLimiter(30, 60 * 60_000);

/** A 429 response, or null when the request may proceed. */
export function limited(
  limiter: ReturnType<typeof createRateLimiter>,
  key: string,
  message = "Твърде много заявки. Опитай отново след малко.",
): NextResponse | null {
  const result = limiter.take(key);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(result.retryAfterSeconds),
      },
    },
  );
}

export { clientKey };
