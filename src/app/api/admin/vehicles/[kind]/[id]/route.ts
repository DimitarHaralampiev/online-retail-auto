import { z } from "zod";
import { database } from "../../../../../../lib/accounts";
import {
  isReferenceKind,
  referenceSchemas,
  setReferenceActive,
  updateReference,
  visibilitySchema,
} from "../../../../../../lib/admin-vehicles";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../../lib/admin-product-http";
import { versionSchema } from "../../../../../../lib/admin-products";
import { json, requestJson } from "../../../../../../lib/order-http";

export const runtime = "nodejs";

const editSchema = z.object({ version: versionSchema, fields: z.unknown() });

/**
 * Shows or hides an entry: PUT {active}. Edits it: PUT {version, fields}.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const admin = await currentAdmin(request);
    if (!admin) return forbidden();
    const body = await requestJson(request);
    const { kind, id: rawId } = await params;
    const id = z.uuid().safeParse(rawId);
    if (!isReferenceKind(kind) || !id.success)
      return json({ error: "Не е намерено." }, 404);
    const visibility = visibilitySchema.safeParse(body);
    if (visibility.success)
      await setReferenceActive(
        database(),
        admin.id,
        kind,
        id.data,
        visibility.data.active,
      );
    else {
      const { version, fields } = editSchema.parse(body);
      await updateReference(
        database(),
        admin.id,
        kind,
        id.data,
        version,
        referenceSchemas[kind].parse(fields),
      );
    }
    refreshStorefront();
    return json({ saved: true });
  } catch (e) {
    return adminProductError(e);
  }
}
