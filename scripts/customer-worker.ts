import {
  scanCustomerNotifications,
  sendCustomerEmails,
} from "../src/lib/customer-notifications";
import { database } from "../src/lib/accounts";
async function run() {
  console.log({
    queued: await scanCustomerNotifications(),
    sent: await sendCustomerEmails(),
  });
}
async function main() {
  if (!process.argv.includes("--watch")) {
    try {
      await run();
    } finally {
      await database().end();
    }
    return;
  }
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  while (!stopping) {
    try {
      await run();
    } catch {
      console.error("Customer notification service unavailable; retrying.");
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 60000));
  }
  await database().end();
}
main().catch(() => {
  console.error("Customer notification worker failed.");
  process.exitCode = 1;
});
