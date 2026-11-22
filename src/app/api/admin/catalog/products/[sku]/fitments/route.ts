import { database } from "../../../../../../../lib/accounts";
import {
  fitmentSchema,
  listAdminFitments,
  saveFitment,
} from "../../../../../../../lib/admin-fitments";
import { skuSchema } from "../../../../../../../lib/admin-products";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../../../lib/order-http";

export const runtime = "nodejs";

type Context = { params: Promise<{ sku: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    if (!(await currentAdmin())) return forbidden();
    const sku = skuSchema.parse((await params).sku);
    return json({ fitments: await listAdminFitments(database(), sku) });
  } catch (e) {
    return adminProductError(e);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const sku = skuSchema.parse((await params).sku);
    const fitment = fitmentSchema.parse(await requestJson(request));
    const outcome = await saveFitment(database(), admin.id, sku, fitment);
    refreshStorefront();
    return json({
      outcome,
      fitments: await listAdminFitments(database(), sku),
    });
  } catch (e) {
    return adminProductError(e);
  }
}
