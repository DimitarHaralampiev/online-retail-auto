import { randomUUID, createHash } from "node:crypto";
import { database } from "./accounts";
import { extractInvoice, researchMarket } from "./invoice-ai";
import {
  reviewedInvoiceSchema,
  acquisitionCosts,
  pricingAssumptionsSchema,
  defaultPricingAssumptions,
  type PricingAssumptions,
  type InvoiceLine,
} from "./invoice-rules";
export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;
export function validateInvoicePdf(bytes: Buffer) {
  if (
    bytes.length < 5 ||
    bytes.length > MAX_INVOICE_BYTES ||
    bytes.subarray(0, 5).toString() !== "%PDF-"
  )
    throw new Error("Качи PDF файл до 10 MB.");
}
export async function uploadInvoice(
  bytes: Buffer,
  filename: string,
  actor: string,
) {
  validateInvoicePdf(bytes);
  const id = randomUUID();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const result = await database().query(
    "INSERT INTO supplier_invoices(id,sha256,filename,pdf,uploaded_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(sha256) DO UPDATE SET sha256=EXCLUDED.sha256 RETURNING id,status",
    [
      id,
      hash,
      filename.replace(/[\r\n]/g, "").slice(0, 180) || "invoice.pdf",
      bytes,
      actor,
    ],
  );
  return { ...result.rows[0], duplicate: result.rows[0].id !== id };
}
export async function getInvoice(id: string) {
  const result = await database().query(
    "SELECT id,filename,status,parse_status,extracted,reviewed,pricing_assumptions,created_at,posted_at FROM supplier_invoices WHERE id=$1",
    [id],
  );
  if (!result.rowCount) throw new Error("Фактурата не е намерена.");
  return result.rows[0];
}
async function claimAi(actor: string, id: string, kind: "extract" | "market") {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT id FROM customers WHERE id=$1 FOR NO KEY UPDATE",
      [actor],
    );
    const invoice = await client.query(
      "SELECT id,status,parse_status,ai_started_at FROM supplier_invoices WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!invoice.rowCount) throw new Error("Фактурата не е намерена.");
    if (kind === "extract" && invoice.rows[0].status === "posted")
      throw new Error("Заприходена фактура не може да се разчита отново.");
    if (
      invoice.rows[0].ai_started_at &&
      Date.now() - new Date(invoice.rows[0].ai_started_at).getTime() < 180000 &&
      invoice.rows[0].parse_status === "processing"
    )
      throw new Error("ИИ вече обработва тази фактура. Изчакай.");
    const count = await client.query(
      "SELECT count(*)::int AS count,max(created_at) AS latest FROM invoice_ai_requests WHERE actor_id=$1 AND created_at>now()-interval '1 hour'",
      [actor],
    );
    if (count.rows[0].count >= 20)
      throw new Error(
        "Достигнат е лимитът от 20 ИИ операции на час за администратор.",
      );
    if (
      count.rows[0].latest &&
      Date.now() - new Date(count.rows[0].latest).getTime() < 10000
    )
      throw new Error("Изчакай 10 секунди между ИИ операциите.");
    await client.query(
      "INSERT INTO invoice_ai_requests(id,actor_id,invoice_id,kind) VALUES($1,$2,$3,$4)",
      [randomUUID(), actor, id, kind],
    );
    if (kind === "extract")
      await client.query(
        "UPDATE supplier_invoices SET parse_status='processing',ai_started_at=now() WHERE id=$1",
        [id],
      );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function parseInvoice(id: string, actor: string) {
  await claimAi(actor, id, "extract");
  try {
    const result = await database().query(
      "SELECT pdf FROM supplier_invoices WHERE id=$1",
      [id],
    );
    const extracted = await extractInvoice(result.rows[0].pdf);
    await database().query(
      "UPDATE supplier_invoices SET extracted=$1,parse_status='ready' WHERE id=$2 AND status='draft'",
      [extracted, id],
    );
    return getInvoice(id);
  } catch (e) {
    await database().query(
      "UPDATE supplier_invoices SET parse_status='failed' WHERE id=$1 AND status='draft'",
      [id],
    );
    throw e;
  }
}
export async function compareInvoiceProduct(
  id: string,
  line: InvoiceLine,
  actor: string,
) {
  await claimAi(actor, id, "market");
  const result = await researchMarket(line);
  await database().query(
    "INSERT INTO invoice_market_research(id,invoice_id,product_identity,result,actor_id) VALUES($1,$2,$3,$4,$5)",
    [
      randomUUID(),
      id,
      {
        name: line.name,
        brand: line.brand,
        manufacturerCode: line.manufacturerCode,
        ean: line.ean,
      },
      result,
      actor,
    ],
  );
  return result;
}
export async function postInvoice(
  id: string,
  input: unknown,
  actor: string,
  assumptions: PricingAssumptions = defaultPricingAssumptions,
) {
  const pricing = pricingAssumptionsSchema.parse(assumptions);
  const invoice = reviewedInvoiceSchema.parse(input);
  const costs = acquisitionCosts(invoice);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const record = await client.query(
      "SELECT status,parse_status,extracted FROM supplier_invoices WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!record.rowCount) throw new Error("Фактурата не е намерена.");
    if (record.rows[0].status === "posted") {
      await client.query("COMMIT");
      return { alreadyPosted: true };
    }
    if (record.rows[0].parse_status === "processing")
      throw new Error("Изчакай ИИ да завърши разчитането.");
    if (
      record.rows[0].extracted &&
      ["credit_note", "other"].includes(record.rows[0].extracted.documentType)
    )
      throw new Error(
        "Този документ не е фактура за доставка. Кредитни известия не се заприхождават като нова стока.",
      );
    const supplierKey = invoice.supplierTaxId
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const ordered = invoice.lines
      .map((line, index) => ({ line, index }))
      .sort((a, b) => a.line.sku.localeCompare(b.line.sku));
    for (const { line, index } of ordered) {
      await client.query(
        "INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [line.sku, line.name, line.brand, line.manufacturerCode, line.ean],
      );
      const existing = await client.query(
        "SELECT brand,manufacturer_code,ean,on_hand FROM warehouse_products WHERE sku=$1 FOR UPDATE",
        [line.sku],
      );
      const p = existing.rows[0];
      if (
        p.brand !== line.brand ||
        p.manufacturer_code !== line.manufacturerCode ||
        p.ean !== line.ean
      )
        throw new Error(
          `Артикулът с SKU ${line.sku} вече принадлежи на продукт с друга идентичност. Избери правилния код.`,
        );
      if (p.on_hand + line.quantity > 1_000_000)
        throw new Error("Наличността надхвърля допустимия лимит.");
      await client.query(
        "INSERT INTO warehouse_receipts(id,invoice_id,line_number,sku,quantity,acquisition_total_cents,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          id,
          index + 1,
          line.sku,
          line.quantity,
          costs[index].totalCents,
          actor,
        ],
      );
      await client.query(
        "UPDATE warehouse_products SET on_hand=on_hand+$1,inventory_value_cents=inventory_value_cents+$2,updated_at=now() WHERE sku=$3",
        [line.quantity, costs[index].totalCents, line.sku],
      );
    }
    await client.query(
      "UPDATE supplier_invoices SET status='posted',reviewed=$1,supplier_key=$2,invoice_number=$3,posted_at=now(),posted_by=$4,pricing_assumptions=$6 WHERE id=$5",
      [
        invoice,
        supplierKey,
        invoice.invoiceNumber.trim().toUpperCase(),
        actor,
        id,
        pricing,
      ],
    );
    await client.query("COMMIT");
    return { alreadyPosted: false };
  } catch (e) {
    await client.query("ROLLBACK");
    if ((e as { code?: string }).code === "23505")
      throw new Error(
        "Тази фактура или складово движение вече е заприходено. Провери доставчика и номера.",
      );
    throw e;
  } finally {
    client.release();
  }
}
