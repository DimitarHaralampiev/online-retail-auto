import { z } from "zod";
import { database } from "../../../../../lib/accounts";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../lib/admin-product-http";
import { importFitments } from "../../../../../lib/fitment-import";
import { json, requestJson } from "../../../../../lib/order-http";
import { MAX_IMPORT_BYTES } from "../../../../../lib/product-import";

export const runtime = "nodejs";
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

/** Check (apply: false) or import (apply: true) of product fitments. */
export async function POST(request: Request) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const body = bodySchema.parse(
      await requestJson(request, MAX_IMPORT_BYTES * 2 + 1024),
    );
    const report = await importFitments(database(), admin.id, body.csv, {
      apply: body.apply,
      filename: body.filename,
    });
    if (report.applied) refreshStorefront();
    return json(report);
  } catch (e) {
    return adminProductError(e);
  }
}
