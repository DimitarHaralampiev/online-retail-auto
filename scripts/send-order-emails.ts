import { sendOrderEmails } from "../src/lib/order-notifications";
import { database } from "../src/lib/accounts";
async function main() {
  try {
    console.log(`Sent ${await sendOrderEmails(50)} queued order emails.`);
  } finally {
    await database().end();
  }
}
main().catch((error) => {
  console.error("Email worker failed", error.code ?? "service error");
  process.exitCode = 1;
});
