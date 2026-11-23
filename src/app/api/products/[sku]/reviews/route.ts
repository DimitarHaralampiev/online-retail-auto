// Reviews of one product (#49): GET published reviews (and, when signed in,
// whether the visitor may review); POST a review from a verified buyer.
import { z } from "zod";
import { currentCustomer } from "../../../../../lib/accounts";
import { skuSchema } from "../../../../../lib/admin-products";
import { json, requestJson } from "../../../../../lib/order-http";
import {
  publishedReviews,
  reviewEligibility,
  ReviewError,
  reviewSchema,
  submitReview,
} from "../../../../../lib/reviews";
import { logError } from "../../../../../lib/log";

export const runtime = "nodejs";

type Context = { params: Promise<{ sku: string }> };

function failure(error: unknown) {
  if (error instanceof ReviewError)
    return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return json({ error: error.issues[0]?.message ?? "Провери данните." }, 400);
  const e = error as { code?: string; message?: string };
  if (!e.code && e.message && /^[А-Я]/u.test(e.message))
    return json({ error: e.message }, 400);
  void logError("Reviews failed", e);
  return json({ error: "Отзивите временно не са достъпни." }, 503);
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const sku = skuSchema.parse((await params).sku);
    const customer = await currentCustomer().catch(() => null);
    const [published, eligibility] = await Promise.all([
      publishedReviews(sku),
      customer ? reviewEligibility(customer.id, sku) : null,
    ]);
    return json({ ...published, eligibility });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const customer = await currentCustomer();
    if (!customer) return json({ error: "Влез в профила си." }, 401);
    const sku = skuSchema.parse((await params).sku);
    const input = reviewSchema.parse(await requestJson(request, 32_768));
    await submitReview(customer, sku, input);
    return json(
      { message: "Благодарим! Отзивът ще се появи след проверка." },
      201,
    );
  } catch (error) {
    return failure(error);
  }
}
