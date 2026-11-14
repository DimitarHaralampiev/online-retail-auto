import { database } from "../../../../../lib/accounts";
import {
  categoryInputSchema,
  categorySlugSchema,
  createCategory,
  listAdminCategories,
} from "../../../../../lib/admin-categories";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../lib/order-http";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!(await currentAdmin())) return forbidden();
    return json({ categories: await listAdminCategories(database()) });
  } catch (e) {
    return adminProductError(e);
  }
}

const createSchema = categoryInputSchema.extend({ slug: categorySlugSchema });

export async function POST(request: Request) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const { slug, ...input } = createSchema.parse(await requestJson(request));
    const category = await createCategory(database(), admin.id, slug, input);
    refreshStorefront();
    return json({ category }, 201);
  } catch (e) {
    return adminProductError(e);
  }
}
