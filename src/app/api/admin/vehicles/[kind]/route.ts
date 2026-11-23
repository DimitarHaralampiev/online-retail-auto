import { database } from "../../../../../lib/accounts";
import {
  createReference,
  createReferenceSchemas,
  isReferenceKind,
} from "../../../../../lib/admin-vehicles";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../lib/order-http";

export const runtime = "nodejs";

/** Adds a make, model, generation or engine to the vehicle reference. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  try {
    const admin = await currentAdmin(request);
    if (!admin) return forbidden();
    const body = await requestJson(request);
    const { kind } = await params;
    if (!isReferenceKind(kind)) return json({ error: "Не е намерено." }, 404);
    const id = await createReference(
      database(),
      admin.id,
      kind,
      createReferenceSchemas[kind].parse(body),
    );
    refreshStorefront();
    return json({ id }, 201);
  } catch (e) {
    return adminProductError(e);
  }
}
