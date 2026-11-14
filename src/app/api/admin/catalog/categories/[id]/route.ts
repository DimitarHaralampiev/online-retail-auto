import { z } from "zod";
import { database } from "../../../../../../lib/accounts";
import {
  categoryInputSchema,
  updateCategory,
} from "../../../../../../lib/admin-categories";
import { versionSchema } from "../../../../../../lib/admin-products";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../../lib/order-http";

export const runtime = "nodejs";

const updateSchema = categoryInputSchema.extend({ version: versionSchema });

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const parsedId = z.uuid().safeParse((await params).id);
    if (!parsedId.success)
      return json({ error: "Категорията не е намерена." }, 404);
    const { version, ...input } = updateSchema.parse(
      await requestJson(request),
    );
    const category = await updateCategory(
      database(),
      admin.id,
      parsedId.data,
      version,
      input,
    );
    refreshStorefront();
    return json({ category });
  } catch (e) {
    return adminProductError(e);
  }
}
