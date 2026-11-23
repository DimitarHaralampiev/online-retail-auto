import { z } from "zod";
import {
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../lib/order-http";
import {
  moderateReview,
  moderationSchema,
  ReviewError,
} from "../../../../../lib/reviews";
import { logError } from "../../../../../lib/log";

export const runtime = "nodejs";

/** Publishes or rejects a review: POST {action}. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return json({ error: "Отзивът не е намерен." }, 404);
    const { action } = moderationSchema.parse(await requestJson(request));
    await moderateReview(admin.id, id.data, action);
    refreshStorefront();
    return json({ saved: true });
  } catch (error) {
    if (error instanceof ReviewError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json({ error: "Невалидно действие." }, 400);
    const e = error as { code?: string; message?: string };
    if (!e.code && e.message && /^[А-Я]/u.test(e.message))
      return json({ error: e.message }, 400);
    void logError("Review moderation failed", e);
    return json({ error: "Отзивите временно не са достъпни." }, 503);
  }
}
