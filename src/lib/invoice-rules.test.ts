import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateCents,
  acquisitionCosts,
  reviewedInvoiceSchema,
  defaultPricingAssumptions,
  priceScenario,
  identityMatches,
  safeSourceUrl,
  type ReviewedInvoice,
} from "./invoice-rules";
import {
  filterMarketOffers,
  responseSources,
  responseText,
} from "./invoice-ai";
import { shippingForSubtotal } from "./shipping-price";
const invoice: ReviewedInvoice = {
  supplierName: "Test",
  supplierTaxId: "TEST-ID",
  invoiceNumber: "123",
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
      sku: "ONE",
      name: "One",
      brand: "Brand",
      manufacturerCode: "MPN",
      ean: "",
      quantity: 2,
      unitNetCents: 1000,
      purchaseVatBps: 2000,
    },
    {
      sku: "TWO",
      name: "Two",
      brand: "Brand",
      manufacturerCode: "2",
      ean: "",
      quantity: 1,
      unitNetCents: 2000,
      purchaseVatBps: 2000,
    },
  ],
};
test("receipt requires reviewed totals, one currency rate and unique SKU", () => {
  assert.equal(reviewedInvoiceSchema.safeParse(invoice).success, true);
  assert.equal(
    reviewedInvoiceSchema.safeParse({ ...invoice, netTotalCents: 1 }).success,
    false,
  );
  assert.equal(
    reviewedInvoiceSchema.safeParse({ ...invoice, exchangeRate: 2 }).success,
    false,
  );
  assert.equal(
    reviewedInvoiceSchema.safeParse({ ...invoice, confirmed: false }).success,
    false,
  );
  assert.equal(
    reviewedInvoiceSchema.safeParse({
      ...invoice,
      lines: [invoice.lines[0], invoice.lines[0]],
    }).success,
    false,
  );
  assert.equal(
    reviewedInvoiceSchema.safeParse({
      ...invoice,
      lines: [{ ...invoice.lines[0], quantity: 1.5 }],
    }).success,
    false,
  );
});
test("acquisition cost adds only nonrecoverable VAT and preserves shared cost", () => {
  const costs = acquisitionCosts(invoice);
  assert.equal(
    costs.reduce((s, c) => s + c.totalCents, 0),
    4301,
  );
  assert.equal(
    acquisitionCosts({ ...invoice, recoverPurchaseVat: false }).reduce(
      (s, c) => s + c.totalCents,
      0,
    ),
    5101,
  );
  assert.deepEqual(allocateCents(1, [1, 1, 1]), [1, 0, 0]);
  assert.deepEqual(allocateCents(301, [2000, 2000]), [151, 150]);
  assert.equal(
    allocateCents(200_000_000, [99_999_999, 1]).reduce((a, b) => a + b, 0),
    200_000_000,
  );
});
test("price target treats VAT separately and covers gross payment fees and shipping", () => {
  const settings = {
    ...defaultPricingAssumptions,
    paymentFeeBps: 200,
    profitTaxBps: 1000,
    courierCostCents: 500,
    packagingCents: 100,
  };
  const paid = priceScenario(1000, settings, false);
  const free = priceScenario(1000, settings, true);
  assert.ok(free.suggestedGrossCents > paid.suggestedGrossCents);
  const net = free.suggestedGrossCents / 1.2;
  const profit = (net - 1600 - free.suggestedGrossCents * 0.02) * 0.9;
  assert.ok(profit / net >= 0.2);
  assert.equal(free.profitAfterTaxCents, Math.floor(profit));
  assert.throws(() =>
    priceScenario(
      1000,
      { ...settings, targetNetMarginBps: 8000, profitTaxBps: 5000 },
      true,
    ),
  );
});
test("free delivery applies strictly above the discounted basket threshold", () => {
  assert.equal(shippingForSubtotal(2999, 500, 3000), 500);
  assert.equal(shippingForSubtotal(3000, 500, 3000), 500);
  assert.equal(shippingForSubtotal(3001, 500, 3000), 0);
  assert.equal(shippingForSubtotal(9999, 500, null), 500);
});
test("market matching requires exact identifier and one selling unit", () => {
  const line = invoice.lines[0];
  assert.equal(
    identityMatches(line, {
      brand: "brand",
      manufacturerCode: "MPN",
      ean: null,
      packQuantity: 1,
    }),
    true,
  );
  assert.equal(
    identityMatches(line, {
      brand: "Other",
      manufacturerCode: "MPN",
      ean: null,
      packQuantity: 1,
    }),
    false,
  );
  assert.equal(
    identityMatches(line, {
      brand: "Brand",
      manufacturerCode: "MPN",
      ean: null,
      packQuantity: 2,
    }),
    false,
  );
  assert.equal(
    identityMatches(line, {
      brand: "Brand",
      manufacturerCode: "MPN",
      ean: null,
      packQuantity: null,
    }),
    false,
  );
});
test("market results exclude invented URLs, unavailable products and unknown VAT", () => {
  const offer = {
    shop: "Test",
    url: "https://shop.example/part",
    title: "One",
    brand: "Brand",
    manufacturerCode: "MPN",
    ean: null,
    packQuantity: 1,
    price: 20,
    currency: "EUR" as const,
    availability: "in_stock" as const,
    includesVat: true,
    shippingNote: "Unknown",
    evidence: "MPN",
  };
  const result = filterMarketOffers(
    invoice.lines[0],
    {
      summary: "Test",
      offers: [
        offer,
        { ...offer, url: "https://fabricated.example/part" },
        { ...offer, includesVat: null },
      ],
    },
    [offer.url],
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].usableForComparison, true);
  assert.equal(result[1].usableForComparison, false);
  assert.equal(safeSourceUrl("javascript:alert(1)"), null);
  assert.equal(safeSourceUrl("https://localhost/test"), null);
  assert.equal(safeSourceUrl("https://user:password@shop.example"), null);
});
test("AI refusals/incomplete outputs fail and search citations are retained", () => {
  assert.throws(() => responseText({ status: "incomplete", output: [] }));
  assert.throws(() =>
    responseText({
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal" }] }],
    }),
  );
  assert.deepEqual(
    responseSources({
      status: "completed",
      output: [
        {
          type: "web_search_call",
          action: { sources: [{ url: "https://shop.example/part" }] },
        },
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "test",
              annotations: [
                { type: "url_citation", url: "https://shop.example/part" },
              ],
            },
          ],
        },
      ],
    }),
    ["https://shop.example/part"],
  );
});
