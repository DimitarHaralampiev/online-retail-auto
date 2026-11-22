import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { currentCustomer } from "./accounts";
import { AdminProductError } from "./admin-products";
import { json } from "./order-http";

/** The signed-in admin, or null (the route answers 403). */
export async function currentAdmin() {
  const customer = await currentCustomer();
  return customer?.isAdmin ? customer : null;
}

export const forbidden = () =>
  json({ error: "Нужен е администраторски достъп." }, 403);

/**
 * Storefront pages read the catalog per request today; this also drops any
 * cached render, so a change is visible to shoppers right away.
 */
export function refreshStorefront() {
  revalidatePath("/", "layout");
}

export function adminProductError(error: unknown) {
  if (error instanceof AdminProductError)
    return json({ error: error.message }, error.status);
  if (error instanceof ZodError)
    return json({ error: error.issues[0]?.message ?? "Провери данните." }, 400);
  const e = error as { code?: string; message?: string };
  // A lost race with a concurrent change (deadlock or serialization failure).
  if (e.code === "40P01" || e.code === "40001")
    return json(
      {
        error:
          "Данните бяха променени междувременно. Презареди и опитай отново.",
      },
      409,
    );
  // lock_timeout: a product stayed locked (e.g. by an order) too long.
  if (e.code === "55P03")
    return json(
      {
        error:
          "Продукт е зает в момента (например поръчка в ход). Опитай отново.",
      },
      409,
    );
  // PostgreSQL refuses NUL characters in text (character_not_in_repertoire).
  if (e.code === "22021")
    return json({ error: "Текстът съдържа недопустими знаци." }, 400);
  // Request-level problems from requestJson (origin, size, format).
  if (!e.code && e.message && /^[А-Я]/u.test(e.message))
    return json({ error: e.message }, 400);
  console.error("Admin catalog service failed", e.code ?? e.message);
  return json(
    { error: "Каталогът временно не е достъпен. Опитай отново." },
    503,
  );
}
