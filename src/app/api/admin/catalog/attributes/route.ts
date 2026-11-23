import { database } from "../../../../../lib/accounts";
import {
  attributeInputSchema,
  attributeKeySchema,
  createAttribute,
  listAttributes,
} from "../../../../../lib/admin-attributes";
import {
  adminProductError,
  currentAdmin,
  forbidden,
  refreshStorefront,
} from "../../../../../lib/admin-product-http";
import { json, requestJson } from "../../../../../lib/order-http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!(await currentAdmin(request))) return forbidden();
    return json({ attributes: await listAttributes(database()) });
  } catch (e) {
    return adminProductError(e);
  }
}

const createSchema = attributeInputSchema.extend({ key: attributeKeySchema });

export async function POST(request: Request) {
  try {
    const admin = await currentAdmin(request);
    if (!admin) return forbidden();
    const { key, ...input } = createSchema.parse(await requestJson(request));
    const attribute = await createAttribute(database(), admin.id, key, input);
    refreshStorefront();
    return json({ attribute }, 201);
  } catch (e) {
    return adminProductError(e);
  }
}
