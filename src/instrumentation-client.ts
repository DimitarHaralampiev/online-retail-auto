// Runs in the browser before the app becomes interactive: reports uncaught
// errors to the shop itself (#117), including ones during start-up. The
// server turns it off with BROWSER_ERRORS=0 (data-browser-errors on <html>).
import { createErrorFilter, sendReport } from "./lib/client-reports";

const filter = createErrorFilter();

function report(error: unknown) {
  try {
    if (document.documentElement.dataset.browserErrors === "off") return;
    const found = filter(error, location.pathname);
    if (found) sendReport(found);
  } catch {
    // Reporting must never cause an error of its own.
  }
}

// `error` is empty for failed images and scripts from other origins.
window.addEventListener("error", (event) => {
  if (event.error) report(event.error);
});
window.addEventListener("unhandledrejection", (event) => report(event.reason));
