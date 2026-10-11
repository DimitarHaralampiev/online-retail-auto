import { z } from "zod";
const nullableText = z.string().max(300).nullable();
const nullableAmount = z.number().finite().min(0).max(1e8).nullable();
export const extractedInvoiceSchema = z
  .object({
    documentType: z.enum(["invoice", "credit_note", "other", "unknown"]),
    supplierName: nullableText,
    supplierTaxId: nullableText,
    invoiceNumber: nullableText,
    invoiceDate: nullableText,
    currency: z.enum(["EUR", "BGN", "other", "unknown"]),
    netTotal: nullableAmount,
    vatTotal: nullableAmount,
    grossTotal: nullableAmount,
    lines: z
      .array(
        z
          .object({
            description: nullableText,
            supplierCode: nullableText,
            brand: nullableText,
            manufacturerCode: nullableText,
            ean: nullableText,
            unit: nullableText,
            quantity: nullableAmount,
            unitNetPrice: nullableAmount,
            lineNetTotal: nullableAmount,
            vatRate: nullableAmount,
          })
          .strict(),
      )
      .max(200),
    warnings: z.array(z.string().max(500)).max(30),
  })
  .strict();
export type ExtractedInvoice = z.infer<typeof extractedInvoiceSchema>;
const cents = z.number().int().min(0).max(100_000_000);
const text = z.string().trim().min(1).max(160);
export const invoiceLineSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/,
        "Използвай латиница, цифри, точка, тире или долна черта за SKU.",
      ),
    name: text,
    brand: z.string().trim().max(80),
    manufacturerCode: z.string().trim().max(80),
    ean: z.string().regex(/^(?:[0-9]{8}|[0-9]{12,14})?$/, "Провери EAN кода."),
    quantity: z.number().int().min(1).max(100_000),
    unitNetCents: cents,
    purchaseVatBps: z.number().int().min(0).max(10000),
  })
  .strict();
export const reviewedInvoiceSchema = z
  .object({
    supplierName: text,
    supplierTaxId: text,
    invoiceNumber: text,
    invoiceDate: z.iso.date(),
    currency: z.enum(["EUR", "BGN"]),
    exchangeRate: z.number().finite().positive().max(100),
    netTotalCents: cents,
    purchaseVatTotalCents: cents,
    inboundShippingCents: cents,
    otherAcquisitionCents: cents,
    recoverPurchaseVat: z.boolean(),
    lines: z.array(invoiceLineSchema).min(1).max(200),
    confirmed: z.literal(true),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.currency === "EUR" && r.exchangeRate !== 1)
      ctx.addIssue({
        code: "custom",
        message: "Курсът EUR → EUR трябва да е 1.",
      });
    if (new Set(r.lines.map((l) => l.sku)).size !== r.lines.length)
      ctx.addIssue({
        code: "custom",
        message:
          "Всеки SKU трябва да е само на един ред. Обедини количествата.",
      });
    const net = r.lines.reduce((s, l) => s + l.quantity * l.unitNetCents, 0);
    const vat = r.lines.reduce(
      (s, l) =>
        s +
        Math.round((l.quantity * l.unitNetCents * l.purchaseVatBps) / 10000),
      0,
    );
    if (Math.abs(net - r.netTotalCents) > r.lines.length)
      ctx.addIssue({
        code: "custom",
        message:
          "Сборът на редовете не съвпада с нетната сума на фактурата. Отрази отстъпките и отдели транспортните услуги.",
      });
    if (Math.abs(vat - r.purchaseVatTotalCents) > r.lines.length)
      ctx.addIssue({
        code: "custom",
        message: "Провери ДДС по редовете и общата ДДС сума.",
      });
    if (!Number.isSafeInteger(net) || net > 100_000_000)
      ctx.addIssue({
        code: "custom",
        message: "Стойността на фактурата надхвърля лимита.",
      });
  });
export type ReviewedInvoice = z.infer<typeof reviewedInvoiceSchema>;
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;
export const pricingAssumptionsSchema = z
  .object({
    vatRegistered: z.boolean(),
    salesVatBps: z.number().int().min(0).max(10000),
    packagingCents: cents,
    overheadCents: cents,
    returnsReserveCents: cents,
    paymentFixedCents: cents,
    paymentFeeBps: z.number().int().min(0).max(5000),
    profitTaxBps: z.number().int().min(0).max(5000),
    targetNetMarginBps: z.number().int().min(0).max(8000),
    courier: z.enum(["econt", "speedy"]),
    courierCostCents: cents,
  })
  .strict();
export type PricingAssumptions = z.infer<typeof pricingAssumptionsSchema>;
export const defaultPricingAssumptions: PricingAssumptions = {
  vatRegistered: true,
  salesVatBps: 2000,
  packagingCents: 0,
  overheadCents: 0,
  returnsReserveCents: 0,
  paymentFixedCents: 0,
  paymentFeeBps: 0,
  profitTaxBps: 0,
  targetNetMarginBps: 2000,
  courier: "econt",
  courierCostCents: 0,
};
// Exact integer allocation preserves the total, including the rounding remainder.
export function allocateCents(total: number, weights: number[]) {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    weights.some((w) => !Number.isSafeInteger(w) || w < 0)
  )
    throw new Error("Невалидно разпределение на разходи.");
  if (!weights.length) return [];
  const sum = weights.reduce((a, b) => a + BigInt(b), BigInt(0));
  const basis = sum ? weights.map(BigInt) : weights.map(() => BigInt(1));
  const denominator = sum || BigInt(weights.length);
  const amount = BigInt(total);
  const parts = basis.map((w) => Number((amount * w) / denominator));
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const ranking = basis
    .map((w, i) => ({ i, fraction: (amount * w) % denominator }))
    .sort((a, b) =>
      a.fraction === b.fraction ? a.i - b.i : a.fraction > b.fraction ? -1 : 1,
    );
  for (const item of ranking) {
    if (!remainder) break;
    parts[item.i]++;
    remainder--;
  }
  return parts;
}
export function acquisitionCosts(invoice: ReviewedInvoice) {
  const weights = invoice.lines.map((l) => l.quantity * l.unitNetCents);
  const net = weights.map((n) => Math.round(n * invoice.exchangeRate));
  const vat = invoice.lines.map((l) =>
    invoice.recoverPurchaseVat
      ? 0
      : Math.round(
          ((l.quantity * l.unitNetCents * l.purchaseVatBps) / 10000) *
            invoice.exchangeRate,
        ),
  );
  const extras = allocateCents(
    invoice.inboundShippingCents + invoice.otherAcquisitionCents,
    weights,
  );
  return invoice.lines.map((l, i) => ({
    sku: l.sku,
    totalCents: net[i] + vat[i] + extras[i],
    unitCents: (net[i] + vat[i] + extras[i]) / l.quantity,
  }));
}
export function priceScenario(
  unitAcquisitionCents: number,
  settings: PricingAssumptions,
  merchantPaysShipping: boolean,
) {
  const s = pricingAssumptionsSchema.parse(settings);
  if (!Number.isFinite(unitAcquisitionCents) || unitAcquisitionCents < 0)
    throw new Error("Невалидна себестойност.");
  const vatFactor = s.vatRegistered ? 1 + s.salesVatBps / 10000 : 1;
  const taxFactor = 1 - s.profitTaxBps / 10000;
  const feeRate = s.paymentFeeBps / 10000;
  const margin = s.targetNetMarginBps / 10000;
  const costs =
    unitAcquisitionCents +
    s.packagingCents +
    s.overheadCents +
    s.returnsReserveCents +
    s.paymentFixedCents +
    (merchantPaysShipping ? s.courierCostCents : 0);
  const denominator = 1 - feeRate * vatFactor - margin / taxFactor;
  if (denominator <= 0)
    throw new Error(
      "Маржът и таксите не позволяват положителна печалба. Намали целта или разходите.",
    );
  const suggestedGrossCents = Math.ceil((costs / denominator) * vatFactor);
  const breakEvenGrossCents = Math.ceil(
    (costs / (1 - feeRate * vatFactor)) * vatFactor,
  );
  const netRevenue = suggestedGrossCents / vatFactor;
  const paymentFee = suggestedGrossCents * feeRate + s.paymentFixedCents;
  const profitBeforeTax =
    netRevenue -
    unitAcquisitionCents -
    s.packagingCents -
    s.overheadCents -
    s.returnsReserveCents -
    (merchantPaysShipping ? s.courierCostCents : 0) -
    paymentFee;
  return {
    suggestedGrossCents,
    breakEvenGrossCents,
    vatCents: Math.round(suggestedGrossCents - netRevenue),
    costsCents: Math.ceil(costs),
    paymentFeeCents: Math.ceil(paymentFee),
    profitAfterTaxCents: Math.floor(profitBeforeTax * taxFactor),
    merchantPaysShipping,
  };
}
export function safeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(
        url.hostname,
      )
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
export const marketResultSchema = z
  .object({
    offers: z
      .array(
        z
          .object({
            shop: z.string().max(160),
            url: z.string().max(2000),
            title: z.string().max(300),
            brand: nullableText,
            manufacturerCode: nullableText,
            ean: nullableText,
            packQuantity: z.number().positive().max(10000).nullable(),
            price: z.number().positive().max(1e8).nullable(),
            currency: z.enum(["EUR", "BGN", "unknown"]),
            availability: z.enum(["in_stock", "out_of_stock", "unknown"]),
            includesVat: z.boolean().nullable(),
            shippingNote: z.string().max(500),
            evidence: z.string().max(500),
          })
          .strict(),
      )
      .max(12),
    summary: z.string().max(2000),
  })
  .strict();
export function identityMatches(
  line: Pick<InvoiceLine, "brand" | "manufacturerCode" | "ean">,
  offer: {
    brand: string | null;
    manufacturerCode: string | null;
    ean: string | null;
    packQuantity: number | null;
  },
) {
  const norm = (s: string) => s.trim().toUpperCase();
  return (
    offer.packQuantity === 1 &&
    ((!!line.ean && line.ean === offer.ean) ||
      (!!line.brand &&
        !!line.manufacturerCode &&
        norm(line.brand) === norm(offer.brand ?? "") &&
        norm(line.manufacturerCode) === norm(offer.manufacturerCode ?? "")))
  );
}
