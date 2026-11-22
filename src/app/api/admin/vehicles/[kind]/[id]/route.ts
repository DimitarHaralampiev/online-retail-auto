import { z } from "zod";
import { database } from "../../../../../../lib/accounts";
import {
  setReferenceActive,
  visibilitySchema,
} from "../../../../../../lib/admin-vehicles";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../../lib/order-http";

export const runtime = "nodejs";

const paramsSchema = z.object({
  kind: z.enum(["make", "model"]),
  id: z.uuid(),
});

/** Shows or hides a make or model: PUT {active}. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const admin = await currentAdmin();
    if (!admin) return forbidden();
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) return json({ error: "Не е намерено." }, 404);
    const { active } = visibilitySchema.parse(await requestJson(request));
    await setReferenceActive(
      database(),
      admin.id,
      parsed.data.kind,
      parsed.data.id,
      active,
    );
    refreshStorefront();
    return json({ saved: true, active });
  } catch (e) {
    return adminProductError(e);
  }
}
