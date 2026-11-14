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
  // PostgreSQL refuses NUL characters in text (character_not_in_repertoire).
  if (e.code === "22021")
    return json({ error: "Текстът съдържа недопустими знаци." }, 400);
  // Request-level problems from requestJson (origin, size, format).
  if (!e.code && e.message && /^[А-Я]/u.test(e.message))
    return json({ error: e.message }, 400);
  console.error("Admin product service failed", e.code ?? e.message);
  return json(
    { error: "Продуктите временно не са достъпни. Опитай отново." },
    503,
  );
}
