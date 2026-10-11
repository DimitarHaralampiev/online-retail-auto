import { z } from "zod";
import { currentCustomer, database } from "../../../../lib/accounts";
import { publicOrder } from "../../../../lib/orders";
import { json } from "../../../../lib/order-http";
import { tokenHash } from "../../../../lib/password";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success)
      return json({ error: "Поръчката не е намерена." }, 404);
    const customer = await currentCustomer();
    const token = request.headers.get("x-order-token");
    const hash =
      token && /^[a-f0-9]{64}$/.test(token) ? tokenHash(token) : null;
    const result = await database().query(
      "SELECT * FROM orders WHERE id=$1 AND (access_hash=$2 OR customer_id=$3 OR $4)",
      [id, hash, customer?.id ?? null, customer?.isAdmin === true],
    );
    if (!result.rows[0])
      return json(
        {
          error:
            "Поръчката не е намерена или нямаш достъп. Отвори линка от имейла.",
        },
        404,
      );
    const history = await database().query(
      "SELECT status,created_at FROM order_history WHERE order_id=$1 ORDER BY created_at,id",
      [id],
    );
    return json({ order: publicOrder(result.rows[0]), history: history.rows });
  } catch {
    return json({ error: "Неуспешно зареждане на поръчката." }, 503);
  }
}
