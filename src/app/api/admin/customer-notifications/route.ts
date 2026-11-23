import { currentCustomer } from "../../../../lib/accounts";
import { outboxCounts } from "../../../../lib/email-outbox";
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
    const { pending, failed } = await outboxCounts("customer_email_outbox");
    return json({ queued, sent, pending, failed });
  } catch (e) {
    return orderError(e);
  }
}
