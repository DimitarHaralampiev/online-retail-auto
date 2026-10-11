import {
  stripeClient,
  recordPaymentEvent,
} from "../../../../lib/order-payments";
import { sendOrderEmails } from "../../../../lib/order-notifications";
import { json } from "../../../../lib/order-http";
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret)
    return json({ error: "Webhook is not configured." }, 400);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Missing body" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        return json({ error: "Request too large" }, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let event;
  try {
    event = stripeClient().webhooks.constructEvent(
      Buffer.concat(chunks),
      signature,
      secret,
    );
  } catch {
    return json({ error: "Invalid signature" }, 400);
  }
  try {
    await recordPaymentEvent(event);
    await sendOrderEmails().catch(() => {});
    return json({ received: true });
  } catch {
    return json({ error: "Payment event could not be processed" }, 500);
  }
}
