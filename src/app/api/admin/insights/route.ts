import { z } from "zod";
import { currentCustomer } from "../../../../lib/accounts";
import { json, requestJson } from "../../../../lib/order-http";
import { invoiceError } from "../../../../lib/invoice-http";
import { businessInsights } from "../../../../lib/business-insights";
const schema = z
  .object({
    question: z.string().trim().min(3).max(2000),
    days: z.number().int().min(1).max(365),
    includeTest: z.boolean(),
    locale: z.enum(["bg", "en"]),
  })
  .strict();
export async function POST(request: Request) {
  try {
    const admin = await currentCustomer();
    if (!admin?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    const input = schema.parse(await requestJson(request));
    return json(
      await businessInsights(
        admin.id,
        input.question,
        input.days,
        input.includeTest,
        input.locale,
      ),
    );
  } catch (e) {
    return invoiceError(e);
  }
}
