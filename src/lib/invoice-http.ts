import { ZodError } from "zod";
import { json } from "./order-http";
import { logError } from "./log";
export function invoiceError(error: unknown) {
  if (error instanceof ZodError)
    return json(
      { error: error.issues[0]?.message ?? "Провери данните на фактурата." },
      400,
    );
  const e = error as { message?: string; code?: string };
  if (!e.code && e.message && /^[А-Я]/u.test(e.message))
    return json({ error: e.message }, 400);
  void logError("Invoice service failed", e);
  return json(
    { error: "Фактурите временно не са достъпни. Опитай отново." },
    503,
  );
}
