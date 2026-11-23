// What browsers report to the shop itself (#117): uncaught errors and, with
// consent, Core Web Vitals. Reports hold no cookies, identifiers, queries or
// fragments. Anyone can post here, so everything is validated, shortened and
// scrubbed before it is logged or reported (client-report-schema.ts). This
// file is part of every page: keep it small and free of dependencies.
export const CLIENT_REPORTS_PATH = "/api/client-reports";
/** Errors one page load may report (a loop must not flood the shop). */
export const MAX_ERRORS_PER_PAGE = 5;
export const MAX_REPORT_BYTES = 8192;

/** On unless BROWSER_ERRORS=0. */
export const browserErrorsEnabled = (
  env: Partial<Record<string, string>> = process.env,
) => env.BROWSER_ERRORS !== "0";

/** Off unless FIELD_VITALS=1; then also only with analytics consent. */
export const fieldVitalsEnabled = (
  env: Partial<Record<string, string>> = process.env,
) => env.FIELD_VITALS === "1";

// Ids and codes in paths would split one page into many (and could identify
// an order): /orders/3f2a… becomes /orders/[id].
export function reportPath(path: string): string {
  const clean = path.split(/[?#]/)[0].slice(0, 200);
  return clean
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}(?=\/|$)/gi, "/[id]")
    .replace(/^\/catalog\/[^/]+/, "/catalog/[sku]");
}

/** A stack without queries and fragments in its addresses. */
export const reportStack = (stack: string) =>
  stack
    .split("\n")
    .slice(0, 20)
    .map((line) => line.replace(/[?#][^\s:)]*/g, "").slice(0, 300))
    .join("\n");

export type VitalName = "LCP" | "CLS" | "INP" | "FCP" | "TTFB";
export type VitalRating = "good" | "needs-improvement" | "poor";
export type ClientReport =
  | {
      type: "error";
      name: string;
      message: string;
      stack?: string;
      path: string;
    }
  | {
      type: "vital";
      name: VitalName;
      value: number;
      rating: VitalRating;
      path: string;
    };

/** Sends a report without ever disturbing the page. */
export function sendReport(report: ClientReport) {
  try {
    void fetch(CLIENT_REPORTS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      // Also while the page is being left; no cookies are needed.
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  } catch {}
}

/**
 * Decides which uncaught errors to report: not ones without details
 * ("Script error."), from browser extensions or already reported by the
 * server (they carry a digest), each only once and only a few per page.
 */
export function createErrorFilter(max = MAX_ERRORS_PER_PAGE) {
  const seen = new Set<string>();
  return (value: unknown, page: string): ClientReport | null => {
    const error =
      value instanceof Error ? value : new Error(String(value).slice(0, 300));
    if ((error as { digest?: unknown }).digest) return null;
    if (value == null || error.message === "Script error.") return null;
    // Requests cancelled by leaving the page.
    if (error.name === "AbortError") return null;
    const stack = reportStack(error.stack ?? "");
    if (/(chrome|moz|safari-web)-extension:/.test(stack)) return null;
    const key = `${error.name}|${error.message}|${stack.split("\n")[1] ?? ""}`;
    if (seen.has(key) || seen.size >= max) return null;
    seen.add(key);
    return {
      type: "error",
      name: error.name.slice(0, 100),
      message: error.message.slice(0, 1000),
      stack: stack.slice(0, 5000),
      path: reportPath(page),
    };
  };
}
