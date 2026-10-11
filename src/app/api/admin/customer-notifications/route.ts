import { currentCustomer, database } from "../../../../lib/accounts";
import {
  scanCustomerNotifications,
  sendCustomerEmails,
} from "../../../../lib/customer-notifications";
import { requestJson, json, orderError } from "../../../../lib/order-http";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    z.object({ action: z.literal("scan") })
      .strict()
      .parse(await requestJson(request));
    const customer = await currentCustomer();
    if (!customer?.isAdmin)
      return json({ error: "Необходим е администраторски достъп." }, 403);
    const queued = await scanCustomerNotifications();
    const sent = await sendCustomerEmails();
    const pending = await database().query(
      "SELECT count(*)::int AS count FROM customer_email_outbox WHERE sent_at IS NULL",
    );
    return json({ queued, sent, pending: pending.rows[0].count });
  } catch (e) {
    return orderError(e);
  }
}
