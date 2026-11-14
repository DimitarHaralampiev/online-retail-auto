import { database } from "../../../../../../../lib/accounts";
import {
  setProductStatus,
  skuSchema,
  statusChangeSchema,
} from "../../../../../../../lib/admin-products";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../../../lib/order-http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sku: string }> },
) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const sku = skuSchema.parse((await params).sku);
    const { status, version } = statusChangeSchema.parse(
      await requestJson(request),
    );
    const product = await setProductStatus(
      database(),
      admin.id,
      sku,
      version,
      status,
    );
    refreshStorefront();
    return json({ product });
  } catch (e) {
    return adminProductError(e);
  }
}
