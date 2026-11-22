import { database } from "../../../../../lib/accounts";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../lib/admin-product-http";
import {
  isLegalSlug,
  legalUpdateSchema,
  saveLegalPage,
} from "../../../../../lib/legal";
import { json, requestJson } from "../../../../../lib/order-http";

export const runtime = "nodejs";

/** Saves a legal page's Bulgarian and English text: PUT {version, contentBg, contentEn}. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const { slug } = await params;
    if (!isLegalSlug(slug)) return json({ error: "Не е намерено." }, 404);
    // Two texts of up to 100,000 characters (Cyrillic is 2 bytes in UTF-8).
    const body = legalUpdateSchema.parse(await requestJson(request, 450_000));
    const page = await saveLegalPage(database(), admin.id, slug, body);
    refreshStorefront();
    return json({ page });
  } catch (e) {
    return adminProductError(e);
  }
}
