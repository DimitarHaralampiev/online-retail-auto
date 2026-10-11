import { currentCustomer, database } from "../../../../lib/accounts";
import {
  defaultPricingAssumptions,
  pricingAssumptionsSchema,
} from "../../../../lib/invoice-rules";
import { requestJson, json } from "../../../../lib/order-http";
import { aiConfigured } from "../../../../lib/invoice-ai";
import {
  uploadInvoice,
  MAX_INVOICE_BYTES,
} from "../../../../lib/supplier-invoices";
import { invoiceError } from "../../../../lib/invoice-http";
export const runtime = "nodejs";
export async function GET() {
  try {
    if (!(await currentCustomer())?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    const [invoices, products, settings] = await Promise.all([
      database().query(
        "SELECT id,filename,status,parse_status,created_at,posted_at FROM supplier_invoices ORDER BY created_at DESC LIMIT 50",
      ),
      database().query(
        "SELECT sku,name,brand,manufacturer_code,ean,on_hand,reserved,inventory_value_cents::text FROM warehouse_products ORDER BY sku LIMIT 500",
      ),
      database().query(
        "SELECT settings FROM store_pricing_settings WHERE id=1",
      ),
    ]);
    return json({
      invoices: invoices.rows,
      products: products.rows,
      aiConfigured: aiConfigured(),
      pricingSettings:
        pricingAssumptionsSchema.safeParse(settings.rows[0]?.settings).data ??
        defaultPricingAssumptions,
    });
  } catch (e) {
    return invoiceError(e);
  }
}
export async function POST(request: Request) {
  try {
    const customer = await currentCustomer();
    if (!customer?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    if (request.headers.get("content-type")?.includes("application/json")) {
      const value = pricingAssumptionsSchema.parse(await requestJson(request));
      await database().query(
        "INSERT INTO store_pricing_settings(id,settings,updated_by) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET settings=$1,updated_by=$2,updated_at=now()",
        [value, customer.id],
      );
      return json({ saved: true });
    }
    const origin = request.headers.get("origin");
    let validOrigin = false;
    try {
      const parsed = new URL(origin ?? "");
      validOrigin =
        ["http:", "https:"].includes(parsed.protocol) &&
        parsed.host === request.headers.get("host");
    } catch {}
    if (!validOrigin) throw new Error("Невалиден произход на заявката.");
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw new Error("Качи файла чрез формата за PDF.");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Липсва файл.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_INVOICE_BYTES + 65536) {
          await reader.cancel();
          throw new Error("Качи PDF файл до 10 MB.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const buffered = new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type")! },
      body: Buffer.concat(chunks),
    });
    const form = await buffered.formData();
    const file = form.get("invoice");
    if (!(file instanceof File) || file.type !== "application/pdf")
      throw new Error("Избери PDF фактура.");
    return json(
      await uploadInvoice(
        Buffer.from(await file.arrayBuffer()),
        file.name,
        customer.id,
      ),
    );
  } catch (e) {
    return invoiceError(e);
  }
}
