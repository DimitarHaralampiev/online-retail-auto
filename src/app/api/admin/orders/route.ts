import { z } from "zod";
import { currentCustomer, database } from "../../../../lib/accounts";
import { changeOrderStatus, publicOrder } from "../../../../lib/orders";
import { orderStatuses } from "../../../../lib/order-state";
import {
  orderOutbox,
  sendOrderEmails,
} from "../../../../lib/order-notifications";
import { outboxCounts, requeueFailed } from "../../../../lib/email-outbox";
import {
  completeRefund,
  completeRefundSchema,
  openRefunds,
  RefundError,
} from "../../../../lib/refunds";
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
    // Legacy handover without a stock movement; the reason is audited.
    stockOverrideReason: z
      .string()
      .trim()
      .min(5, "Опиши защо предаваш без складово движение.")
      .max(300)
      .optional(),
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
    const refunds = await openRefunds();
    return json({
      orders: result.rows.map((order) => ({
        ...publicOrder(order),
        contact: order.contact,
      })),
      pendingEmails: emails.pending,
      failedEmails: emails.failed,
      refunds,
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
    if (data?.action === "refund-done") {
      const { refundId, note } = completeRefundSchema.parse(data);
      await completeRefund(customer.id, refundId, note);
      return json({ completed: true });
    }
    if (data?.action === "retry-emails") {
      // Failed emails (dead letters) get a fresh set of attempts.
      const requeued = await requeueFailed(orderOutbox);
      return json({ requeued, sent: await sendOrderEmails() });
    }
    const change = schema.parse(data);
    if (change.stockOverrideReason && change.status !== "handed_to_courier")
      return json(
        { error: "Изключението важи само при предаване на куриер." },
        400,
      );
    await changeOrderStatus(
      change.id,
      change.status,
      change.expectedStatus,
      customer.id,
      change.trackingNumber,
      change.stockOverrideReason,
    );
    await sendOrderEmails().catch(() => {});
    return json({ updated: true });
  } catch (e) {
    if (e instanceof RefundError) return json({ error: e.message }, e.status);
    return orderError(e);
  }
}
