import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewedInvoice } from "../../src/lib/invoice-rules";
import {
  createProduct,
  productInputSchema,
} from "../../src/lib/admin-products";
import { postInvoice, uploadInvoice } from "../../src/lib/supplier-invoices";
import { insertCustomer, setupTestDatabase } from "./database";

const db = setupTestDatabase();

let pdfCounter = 0;
function pdf(): Buffer {
  pdfCounter += 1;
  return Buffer.from(`%PDF-1.4\n% integration test ${pdfCounter}\n%%EOF`);
}

function reviewed(overrides: Partial<ReviewedInvoice> = {}): ReviewedInvoice {
  return {
    supplierName: "Test Supplier",
    supplierTaxId: "BG123456789",
    invoiceNumber: `INV-${pdfCounter}`,
    invoiceDate: "2026-10-10",
    currency: "EUR",
    exchangeRate: 1,
    netTotalCents: 4000,
    purchaseVatTotalCents: 800,
    inboundShippingCents: 301,
    otherAcquisitionCents: 0,
    recoverPurchaseVat: true,
    confirmed: true,
    lines: [
      {
        sku: `IT-ONE-${pdfCounter}`,
        name: "One",
        brand: "Brand",
        manufacturerCode: "MPN-1",
        ean: "",
        quantity: 2,
        unitNetCents: 1000,
        purchaseVatBps: 2000,
      },
      {
        sku: `IT-TWO-${pdfCounter}`,
        name: "Two",
        brand: "Brand",
        manufacturerCode: "MPN-2",
        ean: "",
        quantity: 1,
        unitNetCents: 2000,
        purchaseVatBps: 2000,
      },
    ],
    ...overrides,
  };
}

async function stock(sku: string) {
  const result = await db().pool.query(
    "SELECT on_hand,inventory_value_cents::int AS value FROM warehouse_products WHERE sku=$1",
    [sku],
  );
  return result.rows[0] ?? null;
}

test("uploading the same PDF twice returns the existing invoice", async () => {
  const actor = await insertCustomer(db().pool, { isAdmin: true });
  const bytes = pdf();
  const first = await uploadInvoice(bytes, "a.pdf", actor);
  const second = await uploadInvoice(bytes, "b.pdf", actor);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.id, first.id);
});

test("rejects files that are not PDFs before touching the database", async () => {
  const actor = await insertCustomer(db().pool, { isAdmin: true });
  await assert.rejects(
    uploadInvoice(Buffer.from("not a pdf"), "x.pdf", actor),
    /PDF/,
  );
});

test("posting receives stock and allocates landed cost to each line", async () => {
  const actor = await insertCustomer(db().pool, { isAdmin: true });
  const { id } = await uploadInvoice(pdf(), "invoice.pdf", actor);
  const invoice = reviewed();
  assert.deepEqual(await postInvoice(id, invoice, actor), {
    alreadyPosted: false,
  });
  const one = await stock(invoice.lines[0].sku);
  const two = await stock(invoice.lines[1].sku);
  assert.equal(one.on_hand, 2);
  assert.equal(two.on_hand, 1);
  // 40.00 net + 3.01 shipping, VAT recovered: the full 43.01 is allocated.
  assert.equal(one.value + two.value, 4301);
});

test("concurrent posting of one invoice receives stock exactly once", async () => {
  const actor = await insertCustomer(db().pool, { isAdmin: true });
  const { id } = await uploadInvoice(pdf(), "invoice.pdf", actor);
  const invoice = reviewed();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => postInvoice(id, invoice, actor)),
  );
  assert.equal(results.filter((result) => !result.alreadyPosted).length, 1);
  assert.equal((await stock(invoice.lines[0].sku)).on_hand, 2);
  const receipts = await db().pool.query(
    "SELECT count(*)::int AS n FROM warehouse_receipts WHERE invoice_id=$1",
    [id],
  );
  assert.equal(receipts.rows[0].n, 2);
});

test("a SKU that belongs to another product rolls back the whole invoice", async () => {
  const actor = await insertCustomer(db().pool, { isAdmin: true });
  const first = await uploadInvoice(pdf(), "first.pdf", actor);
  const original = reviewed();
  await postInvoice(first.id, original, actor);

  const second = await uploadInvoice(pdf(), "second.pdf", actor);
  const conflicting = reviewed();
  conflicting.lines[1] = {
    ...conflicting.lines[1],
    sku: original.lines[0].sku,
    manufacturerCode: "DIFFERENT",
  };
  await assert.rejects(
    postInvoice(second.id, conflicting, actor),
    /друга идентичност/,
  );
  // The first line of the failed invoice must not have been received either.
  assert.equal(await stock(conflicting.lines[0].sku), null);
  assert.equal((await stock(original.lines[0].sku)).on_hand, 2);
  const status = await db().pool.query(
    "SELECT status FROM supplier_invoices WHERE id=$1",
    [second.id],
  );
  assert.notEqual(status.rows[0].status, "posted");
});

test("an admin-created product receives stock and gains its codes from the invoice", async () => {
  const actor = await insertCustomer(db().pool, { isAdmin: true });
  const sku = `IT-ADMIN-${pdfCounter}`;
  await createProduct(
    db().pool,
    actor,
    sku,
    productInputSchema.parse({ name: { bg: "Админ продукт" }, brand: "brand" }),
  );
  const { id } = await uploadInvoice(pdf(), "admin.pdf", actor);
  const invoice = reviewed();
  invoice.lines[0] = { ...invoice.lines[0], sku };
  await postInvoice(id, invoice, actor);
  const row = await db().pool.query(
    "SELECT on_hand,brand,manufacturer_code,content_version FROM warehouse_products WHERE sku=$1",
    [sku],
  );
  // The admin's brand spelling is kept; the empty code is filled in.
  assert.deepEqual(row.rows[0], {
    on_hand: 2,
    brand: "brand",
    manufacturer_code: "MPN-1",
    // Filling codes bumps the version, so a stale admin form gets a 409.
    content_version: 2,
  });
  // Once known, a different code is a conflict again.
  const second = await uploadInvoice(pdf(), "admin-2.pdf", actor);
  const conflicting = reviewed();
  conflicting.lines[0] = {
    ...conflicting.lines[0],
    sku,
    manufacturerCode: "MPN-9",
  };
  await assert.rejects(
    postInvoice(second.id, conflicting, actor),
    /друга идентичност/,
  );
});

test("a line without any identity cannot post stock onto a known product", async () => {
  const actor = await insertCustomer(db().pool, { isAdmin: true });
  const first = await uploadInvoice(pdf(), "known.pdf", actor);
  const original = reviewed();
  await postInvoice(first.id, original, actor);
  const second = await uploadInvoice(pdf(), "blank.pdf", actor);
  const blank = reviewed();
  blank.lines[1] = {
    ...blank.lines[1],
    sku: original.lines[0].sku,
    brand: "",
    manufacturerCode: "",
    ean: "",
  };
  await assert.rejects(
    postInvoice(second.id, blank, actor),
    /друга идентичност/,
  );
  assert.equal(await stock(blank.lines[0].sku), null);
  assert.equal((await stock(original.lines[0].sku)).on_hand, 2);
});
