import { currentAdmin, forbidden } from "../../../../lib/admin-product-http";
import { json } from "../../../../lib/order-http";
import { reviewsForModeration } from "../../../../lib/reviews";
import { logError } from "../../../../lib/log";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!(await currentAdmin(request))) return forbidden();
    const status = new URL(request.url).searchParams.get("status");
    return json({
      reviews: await reviewsForModeration(
        status === "published" || status === "rejected" ? status : "pending",
      ),
    });
  } catch (error) {
    void logError("Admin reviews failed", error);
    return json({ error: "Отзивите временно не са достъпни." }, 503);
  }
}
