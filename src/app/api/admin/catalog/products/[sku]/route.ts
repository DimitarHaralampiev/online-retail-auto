import { database } from "../../../../../../lib/accounts";
import {
  getAdminProduct,
  productHistory,
  productInputSchema,
  skuSchema,
  updateProduct,
  versionSchema,
} from "../../../../../../lib/admin-products";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../../lib/order-http";

export const runtime = "nodejs";

type Context = { params: Promise<{ sku: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    if (!(await currentAdmin())) return forbidden();
    const sku = skuSchema.parse((await params).sku);
    const product = await getAdminProduct(database(), sku);
    if (!product) return json({ error: "Продуктът не е намерен." }, 404);
    return json({ product, history: await productHistory(database(), sku) });
  } catch (e) {
    return adminProductError(e);
  }
}

const updateSchema = productInputSchema.extend({ version: versionSchema });

export async function PUT(request: Request, { params }: Context) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const sku = skuSchema.parse((await params).sku);
    const { version, ...input } = updateSchema.parse(
      await requestJson(request, 65536),
    );
    const product = await updateProduct(
      database(),
      admin.id,
      sku,
      version,
      input,
    );
    if (product.status === "published") refreshStorefront();
    return json({ product });
  } catch (e) {
    return adminProductError(e);
  }
}
