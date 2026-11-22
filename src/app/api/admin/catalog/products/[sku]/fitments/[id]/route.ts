import { z } from "zod";
import { database } from "../../../../../../../../lib/accounts";
import {
  listAdminFitments,
  removeFitmentById,
} from "../../../../../../../../lib/admin-fitments";
import { skuSchema } from "../../../../../../../../lib/admin-products";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../../../../lib/admin-product-http";
import {
  json,
  requireSameOrigin,
} from "../../../../../../../../lib/order-http";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sku: string; id: string }> },
) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    requireSameOrigin(request);
    const { sku: rawSku, id: rawId } = await params;
    const id = z.uuid().safeParse(rawId);
    if (!id.success)
      return json({ error: "Съвместимостта не е намерена." }, 404);
    const sku = skuSchema.parse(rawSku);
    await removeFitmentById(database(), admin.id, sku, id.data);
    refreshStorefront();
    return json({ fitments: await listAdminFitments(database(), sku) });
  } catch (e) {
    return adminProductError(e);
  }
}
