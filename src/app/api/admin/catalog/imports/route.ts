import { z } from "zod";
import { database } from "../../../../../lib/accounts";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../lib/order-http";
import {
  importProducts,
  MAX_IMPORT_BYTES,
} from "../../../../../lib/product-import";

export const runtime = "nodejs";
// Large imports run in one transaction; allow them time to finish.
export const maxDuration = 120;

const bodySchema = z.object({
  csv: z
    .string()
    .refine(
      (csv) => Buffer.byteLength(csv, "utf8") <= MAX_IMPORT_BYTES,
      "Файлът е по-голям от 2 MB.",
    ),
  apply: z.boolean(),
  filename: z.string().trim().max(200).optional(),
});

/** Dry run (apply: false) or import (apply: true) of a product CSV. */
export async function POST(request: Request) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    // JSON escaping can roughly double a CSV's size in the worst case.
    const body = bodySchema.parse(
      await requestJson(request, MAX_IMPORT_BYTES * 2 + 1024),
    );
    const report = await importProducts(database(), admin.id, body.csv, {
      apply: body.apply,
      filename: body.filename,
    });
    if (report.applied) refreshStorefront();
    return json(report);
  } catch (e) {
    return adminProductError(e);
  }
}
