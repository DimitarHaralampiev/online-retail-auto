import { z } from "zod";
import { currentCustomer, database } from "../../../../../lib/accounts";
import { json, requestJson } from "../../../../../lib/order-http";
import {
  getInvoice,
  parseInvoice,
  postInvoice,
  compareInvoiceProduct,
} from "../../../../../lib/supplier-invoices";
import {
  invoiceLineSchema,
  pricingAssumptionsSchema,
} from "../../../../../lib/invoice-rules";
import { invoiceError } from "../../../../../lib/invoice-http";
import { aiConfigured } from "../../../../../lib/invoice-ai";
export const runtime = "nodejs";
export const maxDuration = 180;
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    if (!(await currentCustomer())?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    const id = z.uuid().parse((await params).id);
    if (new URL(request.url).searchParams.get("download") === "pdf") {
      const row = await database().query(
        "SELECT pdf FROM supplier_invoices WHERE id=$1",
        [id],
      );
      if (!row.rowCount) throw new Error("Фактурата не е намерена.");
      return new Response(new Uint8Array(row.rows[0].pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "attachment; filename=invoice.pdf",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const [invoice, research] = await Promise.all([
      getInvoice(id),
      database().query(
        "SELECT product_identity,result,created_at FROM invoice_market_research WHERE invoice_id=$1 ORDER BY created_at DESC LIMIT 20",
        [id],
      ),
    ]);
    return json({ ...invoice, research: research.rows });
  } catch (e) {
    return invoiceError(e);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const customer = await currentCustomer();
    if (!customer?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    const id = z.uuid().parse((await params).id);
    const data = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("extract") }).strict(),
        z
          .object({
            action: z.literal("post"),
            invoice: z.unknown(),
            pricingAssumptions: pricingAssumptionsSchema.optional(),
          })
          .strict(),
        z
          .object({ action: z.literal("market"), line: invoiceLineSchema })
          .strict(),
      ])
      .parse(await requestJson(request, 128 * 1024));
    if (data.action === "post")
      return json(
        await postInvoice(
          id,
          data.invoice,
          customer.id,
          data.pricingAssumptions,
        ),
      );
    if (!aiConfigured())
      return json(
        {
          error:
            "ИИ още не е конфигуриран. Добави OPENAI_API_KEY в защитената конфигурация.",
        },
        503,
      );
    return json(
      data.action === "extract"
        ? await parseInvoice(id, customer.id)
        : await compareInvoiceProduct(id, data.line, customer.id),
    );
  } catch (e) {
    return invoiceError(e);
  }
}
