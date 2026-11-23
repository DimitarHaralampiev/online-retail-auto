import { database } from "../../../../../../lib/accounts";
import {
  attributeInputSchema,
  attributeKeySchema,
  updateAttribute,
} from "../../../../../../lib/admin-attributes";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../../lib/admin-product-http";
import { versionSchema } from "../../../../../../lib/admin-products";
import { json, requestJson } from "../../../../../../lib/order-http";

export const runtime = "nodejs";

const updateSchema = attributeInputSchema.extend({ version: versionSchema });

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const admin = await currentAdmin(request);
    if (!admin) return forbidden();
    const body = await requestJson(request);
    const key = attributeKeySchema.safeParse((await params).key);
    if (!key.success)
      return json({ error: "Характеристиката не е намерена." }, 404);
    const { version, ...input } = updateSchema.parse(body);
    const attribute = await updateAttribute(
      database(),
      admin.id,
      key.data,
      version,
      input,
    );
    refreshStorefront();
    return json({ attribute });
  } catch (e) {
    return adminProductError(e);
  }
}
