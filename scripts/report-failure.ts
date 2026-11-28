// Reports a failed operations task (backup, restore check) like any handled
// server failure (#56): a JSON log line and, with SENTRY_DSN, an error report.
//   node --import tsx scripts/report-failure.ts "<what failed>"
import { logError } from "../src/lib/log";

const message = process.argv.slice(2).join(" ").trim() || "Task failed";
logError(message, new Error(message), { task: "operations" }).then(() => {
  process.exitCode = 1;
});
