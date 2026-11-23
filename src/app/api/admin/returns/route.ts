import { json } from "../../../../lib/order-http";
import { currentAdmin, forbidden } from "../../../../lib/admin-product-http";
import { adminReturns, type ReturnStatus } from "../../../../lib/returns";
import { logError } from "../../../../lib/log";

export const runtime = "nodejs";

const STATUSES = new Set(["requested", "approved", "rejected", "received"]);

export async function GET(request: Request) {
  try {
    if (!(await currentAdmin(request))) return forbidden();
    const status = new URL(request.url).searchParams.get("status");
    return json({
      returns: await adminReturns(
        status && STATUSES.has(status) ? (status as ReturnStatus) : undefined,
      ),
    });
  } catch (error) {
    void logError("Admin returns failed", error);
    return json({ error: "Връщанията временно не са достъпни." }, 503);
  }
}
