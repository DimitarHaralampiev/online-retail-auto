// Health check (#52). GET /api/health is the readiness probe (database
// included; 503 when it fails); GET /api/health?probe=live only says the
// process answers. Neither reveals versions or error details.
import { NextResponse } from "next/server";
import { cachedHealth } from "../../../lib/health";
import { log } from "../../../lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("probe") === "live")
    return NextResponse.json({ status: "ok" }, { headers });
  const health = await cachedHealth();
  if (health.status !== "ok")
    log("warn", "Health check failed", { checks: health.checks });
  return NextResponse.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers,
  });
}
