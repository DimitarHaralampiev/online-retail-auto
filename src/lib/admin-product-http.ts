import { revalidatePath, revalidateTag } from "next/cache";
import { CATALOG_TAG } from "./catalog-cache";
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
 * Makes an admin change visible to shoppers right away: expires the cached
 * catalog data (no stale serving) and any cached render.
 */
export function refreshStorefront() {
  revalidateTag(CATALOG_TAG, { expire: 0 });
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
