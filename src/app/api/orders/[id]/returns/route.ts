// A customer's return requests for their own delivered order (#48).
import { z } from "zod";
import { currentCustomer } from "../../../../../lib/accounts";
import { json, requestJson } from "../../../../../lib/order-http";
import {
  customerReturns,
  requestReturn,
  ReturnError,
  returnRequestSchema,
} from "../../../../../lib/returns";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  if (error instanceof ReturnError)
    return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return json({ error: error.issues[0]?.message ?? "Провери данните." }, 400);
  const e = error as { code?: string; message?: string };
  if (!e.code && e.message && /^[А-Я]/u.test(e.message))
    return json({ error: e.message }, 400);
  console.error("Return request failed", e.code ?? "service error");
  return json({ error: "Връщанията временно не са достъпни." }, 503);
}

async function orderId(context: Context) {
  const parsed = z.uuid().safeParse((await context.params).id);
  return parsed.success ? parsed.data : null;
}

export async function GET(_request: Request, context: Context) {
  try {
    const customer = await currentCustomer();
    if (!customer) return json({ error: "Влез в профила си." }, 401);
    const id = await orderId(context);
    if (!id) return json({ error: "Поръчката не е намерена." }, 404);
    return json({ returns: await customerReturns(customer.id, id) });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const customer = await currentCustomer();
    if (!customer) return json({ error: "Влез в профила си." }, 401);
    const id = await orderId(context);
    if (!id) return json({ error: "Поръчката не е намерена." }, 404);
    const input = returnRequestSchema.parse(await requestJson(request));
    const requestId = await requestReturn(customer.id, id, input);
    return json(
      { id: requestId, returns: await customerReturns(customer.id, id) },
      201,
    );
  } catch (e) {
    return failure(e);
  }
}
