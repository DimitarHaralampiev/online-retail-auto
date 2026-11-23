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
    const body = await requestJson(request);
    const customer = await currentCustomer(request);
    if (!customer?.isAdmin)
      return json({ error: "Необходим е администраторски достъп." }, 403);
    z.object({ action: z.literal("scan") })
      .strict()
      .parse(body);
    const queued = await scanCustomerNotifications();
    const sent = await sendCustomerEmails();
    const { pending, failed } = await outboxCounts("customer_email_outbox");
    return json({ queued, sent, pending, failed });
  } catch (e) {
    return orderError(e);
  }
}
