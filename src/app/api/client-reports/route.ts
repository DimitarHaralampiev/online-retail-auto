// Browser errors and field Core Web Vitals (#117). Same-origin, small,
// rate limited per client and overall, and always answered without content:
// a browser has nothing to do with the result.
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  browserErrorsEnabled,
  fieldVitalsEnabled,
  MAX_REPORT_BYTES,
} from "../../../lib/client-reports";
import { clientReportSchema } from "../../../lib/client-report-schema";
import { scrub } from "../../../lib/error-reporting";
import { log, logError } from "../../../lib/log";
import { requestJson } from "../../../lib/order-http";
import { clientKey, createRateLimiter } from "../../../lib/rate-limit";

export const runtime = "nodejs";

const perClient = createRateLimiter(30, 60_000);
const overall = createRateLimiter(600, 60_000);

const answer = (status: number) =>
  new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (
    !perClient.take(clientKey(request)).allowed ||
    !overall.take("all").allowed
  )
    return answer(429);
  let body: unknown;
  try {
    body = await requestJson(request, MAX_REPORT_BYTES);
  } catch {
    return answer(400);
  }
  let report;
  try {
    report = clientReportSchema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) return answer(400);
    throw error;
  }
  if (report.type === "error") {
    if (!browserErrorsEnabled()) return answer(204);
    const error = new Error(scrub(report.message));
    error.name = report.name || "Error";
    error.stack = `${error.name}: ${error.message}\n${report.stack
      .split("\n")
      .filter((line) => /^\s*at |@/.test(line))
      .join("\n")}`;
    await logError("Browser error", error, { path: report.path });
  } else if (fieldVitalsEnabled())
    log("info", "Web vital", {
      name: report.name,
      value: Math.round(report.value * 1000) / 1000,
      rating: report.rating,
      path: report.path,
    });
  return answer(204);
}
