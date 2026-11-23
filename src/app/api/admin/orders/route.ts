import { z } from "zod";
import { currentCustomer, database } from "../../../../lib/accounts";
import { changeOrderStatus, publicOrder } from "../../../../lib/orders";
import { orderStatuses } from "../../../../lib/order-state";
import {
  orderOutbox,
  sendOrderEmails,
} from "../../../../lib/order-notifications";
import { outboxCounts, requeueFailed } from "../../../../lib/email-outbox";
import { requestJson, json, orderError } from "../../../../lib/order-http";
const schema = z
  .object({
    id: z.uuid(),
    status: z.enum(
      Object.keys(orderStatuses) as [
        keyof typeof orderStatuses,
        ...(keyof typeof orderStatuses)[],
      ],
    ),
    expectedStatus: z.enum(
      Object.keys(orderStatuses) as [
        keyof typeof orderStatuses,
        ...(keyof typeof orderStatuses)[],
      ],
    ),
    trackingNumber: z.string().trim().max(80).optional(),
  })
  .strict();
export async function GET(request: Request) {
  try {
    const customer = await currentCustomer(request);
    if (!customer?.isAdmin)
      return json({ error: "Необходим е администраторски достъп." }, 403);
    const result = await database().query(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT 50",
    );
    const emails = await outboxCounts("order_email_outbox");
    return json({
      orders: result.rows.map((order) => ({
        ...publicOrder(order),
        contact: order.contact,
      })),
      pendingEmails: emails.pending,
      failedEmails: emails.failed,
    });
  } catch {
    return json({ error: "Неуспешно зареждане." }, 503);
  }
}
export async function POST(request: Request) {
  try {
    const data = await requestJson(request);
    const customer = await currentCustomer(request);
    if (!customer?.isAdmin)
      return json({ error: "Необходим е администраторски достъп." }, 403);
    if (data?.action === "retry-emails") {
      // Failed emails (dead letters) get a fresh set of attempts.
      const requeued = await requeueFailed(orderOutbox);
      return json({ requeued, sent: await sendOrderEmails() });
    }
    const change = schema.parse(data);
    await changeOrderStatus(
      change.id,
      change.status,
      change.expectedStatus,
      customer.id,
      change.trackingNumber,
    );
    await sendOrderEmails().catch(() => {});
    return json({ updated: true });
  } catch (e) {
    return orderError(e);
  }
}
