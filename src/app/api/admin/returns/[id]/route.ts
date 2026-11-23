import { z } from "zod";
import { currentAdmin, forbidden } from "../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../lib/order-http";
import {
  decisionSchema,
  processReturn,
  ReturnError,
} from "../../../../../lib/returns";

export const runtime = "nodejs";

/** Approves, rejects or receives a return: POST {action, note}. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return json({ error: "Заявката не е намерена." }, 404);
    const input = decisionSchema.parse(await requestJson(request));
    const status = await processReturn(admin.id, id.data, input);
    return json({ status });
  } catch (error) {
    if (error instanceof ReturnError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues[0]?.message ?? "Провери данните." },
        400,
      );
    const e = error as { code?: string; message?: string };
    if (!e.code && e.message && /^[А-Я]/u.test(e.message))
      return json({ error: e.message }, 400);
    console.error("Return update failed", e.code ?? "service error");
    return json({ error: "Връщанията временно не са достъпни." }, 503);
  }
}
