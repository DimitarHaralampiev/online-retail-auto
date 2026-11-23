import { z } from "zod";
import { database } from "../../../../../lib/accounts";
import {
  adminProductError,
  currentAdmin,
  forbidden,
} from "../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../lib/order-http";
import { MAX_IMPORT_BYTES } from "../../../../../lib/product-import";
import { importVehicles } from "../../../../../lib/vehicle-import";

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

/** Check (apply: false) or import (apply: true) of vehicle reference data. */
export async function POST(request: Request) {
  try {
    const admin = await currentAdmin(request);
    if (!admin) return forbidden();
    const body = bodySchema.parse(
      await requestJson(request, MAX_IMPORT_BYTES * 2 + 1024),
    );
    return json(
      await importVehicles(database(), admin.id, body.csv, {
        apply: body.apply,
        filename: body.filename,
      }),
    );
  } catch (e) {
    return adminProductError(e);
  }
}
