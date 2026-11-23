// What the error pages (#134) need from an error caught by React.
import { createErrorFilter, sendReport } from "./client-reports";

/** The code under which the server logged the error, if it is the server's. */
export function errorCode(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^[\w@-]{1,64}$/.test(digest)
    ? digest
    : null;
}

const filter = createErrorFilter();

/**
 * Reports an error React caught (it never reaches window.onerror). Errors of
 * the server carry a digest and were reported there.
 */
export function reportCaughtError(error: unknown): void {
  try {
    if (document.documentElement.dataset.browserErrors === "off") return;
    const report = filter(error, location.pathname);
    if (report) sendReport(report);
  } catch {
    // An error page must not fail itself.
  }
}
