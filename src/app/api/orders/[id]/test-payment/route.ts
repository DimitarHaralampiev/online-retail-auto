import { z } from "zod";
import { currentCustomer, database } from "../../../../../lib/accounts";
import { simulatorEnabled } from "../../../../../lib/order-config";
import { tokenHash } from "../../../../../lib/password";
import {
  queueOrderEmail,
  sendOrderEmails,
} from "../../../../../lib/order-notifications";
import { requestJson, json, orderError } from "../../../../../lib/order-http";
import { randomUUID } from "node:crypto";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!simulatorEnabled())
    return json(
      { error: "Симулаторът е достъпен само в локална разработка." },
      404,
    );
  try {
    const { id } = await params;
    z.uuid().parse(id);
    const data = z
      .object({ outcome: z.enum(["success", "failure"]) })
      .strict()
      .parse(await requestJson(request));
    const customer = await currentCustomer();
    const token = request.headers.get("x-order-token");
    const hash =
      token && /^[a-f0-9]{64}$/.test(token) ? tokenHash(token) : null;
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM orders WHERE id=$1 AND (access_hash=$2 OR customer_id=$3 OR $4) FOR UPDATE",
        [id, hash, customer?.id ?? null, customer?.isAdmin === true],
      );
      const order = result.rows[0];
      if (!order || order.mode !== "test" || order.payment_method !== "card") {
        await client.query("ROLLBACK");
        return json({ error: "Поръчката не е намерена." }, 404);
      }
      if (order.payment_status !== "paid") {
        await client.query(
          "UPDATE orders SET payment_status=$1,updated_at=now() WHERE id=$2",
          [data.outcome === "success" ? "paid" : "failed", id],
        );
        const saved = await client.query(
          "INSERT INTO payment_events(id,order_id) VALUES ($1,$2) ON CONFLICT(id) DO NOTHING RETURNING id",
          [`simulator-${id}-${data.outcome}`, id],
        );
        if (saved.rowCount)
          await queueOrderEmail(
            client,
            order,
            data.outcome === "success"
              ? "Тестовото плащане е симулирано успешно. Не са таксувани пари."
              : "Тестовото плащане е отказано. Можеш да опиташ отново в симулатора.",
          );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    await sendOrderEmails().catch(() => {});
    return json({ updated: true });
  } catch (e) {
    return orderError(e);
  }
}
