import { currentCustomer, database } from "../../../lib/accounts";
import { createOrder, orderUrl, publicOrder } from "../../../lib/orders";
import { checkoutPayment } from "../../../lib/order-payments";
import { sendOrderEmails } from "../../../lib/order-notifications";
import { requestJson, json, orderError } from "../../../lib/order-http";
export async function POST(request: Request) {
  try {
    const customer = await currentCustomer();
    const order = await createOrder(
      await requestJson(request),
      customer?.id ?? null,
    );
    let paymentUrl = null;
    try {
      paymentUrl = await checkoutPayment(order);
    } catch {}
    await sendOrderEmails().catch(() => {});
    return json({
      id: order.id,
      mode: "test",
      trackingUrl: orderUrl(order.id),
      paymentUrl,
      paymentPending: order.payment_method === "card" && !paymentUrl,
    });
  } catch (e) {
    return orderError(e);
  }
}

export async function GET() {
  try {
    const customer = await currentCustomer();
    if (!customer) return json({ error: "Влез в профила си." }, 401);
    const orders = await database().query(
      "SELECT * FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 20",
      [customer.id],
    );
    return json({ orders: orders.rows.map(publicOrder) });
  } catch {
    return json({ error: "Поръчките временно не са достъпни." }, 503);
  }
}
