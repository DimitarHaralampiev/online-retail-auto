import { database } from "../../../../../lib/accounts";
import {
  createProduct,
  listAdminProducts,
  listQuerySchema,
  newSkuSchema,
  productInputSchema,
} from "../../../../../lib/admin-products";
import {
  adminProductError,
  currentAdmin,
  forbidden,
} from "../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../lib/order-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!(await currentAdmin())) return forbidden();
    const params = new URL(request.url).searchParams;
    const query = listQuerySchema.parse({
      status: params.get("status") || undefined,
      q: params.get("q") || undefined,
      page: params.get("page") || undefined,
    });
    return json(await listAdminProducts(database(), query));
  } catch (e) {
    return adminProductError(e);
  }
}

const createSchema = productInputSchema.extend({ sku: newSkuSchema });

export async function POST(request: Request) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const { sku, ...input } = createSchema.parse(
      await requestJson(request, 65536),
    );
    const product = await createProduct(database(), admin.id, sku, input);
    return json({ product }, 201);
  } catch (e) {
    return adminProductError(e);
  }
}
