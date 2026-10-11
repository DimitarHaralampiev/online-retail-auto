import { z } from "zod";
import { currentCustomer, database } from "../../../../lib/accounts";
import { changeOrderStatus, publicOrder } from "../../../../lib/orders";
import { orderStatuses } from "../../../../lib/order-state";
import { sendOrderEmails } from "../../../../lib/order-notifications";
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
export async function GET() {
  try {
    const customer = await currentCustomer();
    if (!customer?.isAdmin)
      return json({ error: "Необходим е администраторски достъп." }, 403);
    const result = await database().query(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT 50",
    );
    const pending = await database().query(
      "SELECT count(*)::int AS count FROM order_email_outbox WHERE sent_at IS NULL",
    );
    return json({
      orders: result.rows.map((order) => ({
        ...publicOrder(order),
        contact: order.contact,
      })),
      pendingEmails: pending.rows[0].count,
    });
  } catch {
    return json({ error: "Неуспешно зареждане." }, 503);
  }
}
export async function POST(request: Request) {
  try {
    const data = await requestJson(request);
    const customer = await currentCustomer();
    if (!customer?.isAdmin)
      return json({ error: "Необходим е администраторски достъп." }, 403);
    if (data?.action === "retry-emails") {
      return json({ sent: await sendOrderEmails() });
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
