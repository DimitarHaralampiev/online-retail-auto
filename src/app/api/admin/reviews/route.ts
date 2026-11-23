import { currentAdmin, forbidden } from "../../../../lib/admin-product-http";
import { json } from "../../../../lib/order-http";
import { reviewsForModeration } from "../../../../lib/reviews";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!(await currentAdmin())) return forbidden();
    const status = new URL(request.url).searchParams.get("status");
    return json({
      reviews: await reviewsForModeration(
        status === "published" || status === "rejected" ? status : "pending",
      ),
    });
  } catch (error) {
    console.error("Admin reviews failed", (error as { code?: string }).code);
    return json({ error: "Отзивите временно не са достъпни." }, 503);
  }
}
