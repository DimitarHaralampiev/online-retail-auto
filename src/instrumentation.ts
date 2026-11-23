// Server error capture (#52): every error Next.js catches while rendering
// a page or running a route handler is logged as structured JSON and, with
// SENTRY_DSN, reported to Sentry.
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log, REQUEST_ID_HEADER } = await import("./lib/log");
  const { reportError } = await import("./lib/error-reporting");
  const header = request.headers[REQUEST_ID_HEADER];
  const requestId = Array.isArray(header) ? header[0] : header;
  // The path without its query (it may carry personal data).
  const route = request.path.split("?")[0];
  log("error", "Request failed", {
    requestId,
    method: request.method,
    route,
    routeType: context.routeType,
    error,
  });
  await reportError(error, {
    route: context.routePath || route,
    method: request.method,
    requestId,
    routeType: context.routeType,
  });
};
