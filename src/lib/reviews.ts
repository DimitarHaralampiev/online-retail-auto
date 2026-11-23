// Verified-purchase product reviews with moderation (#49). A customer may
// review a product once, after an order containing it was delivered; the
// review appears only once an admin publishes it. Shown ratings come from
// published reviews only — nothing is estimated or seeded.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { database } from "./accounts";

type Queryable = Pick<pg.Pool, "query">;

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

const text = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .refine((v) => !v.includes("\u0000"), "Текстът съдържа недопустими знаци.");

export const reviewSchema = z
  .object({
    rating: z
      .number()
      .int()
      .min(1, "Избери оценка от 1 до 5.")
      .max(5, "Избери оценка от 1 до 5."),
    title: text(120, "Заглавието е до 120 знака.").default(""),
    body: text(4000, "Отзивът е до 4000 знака.").pipe(
      z.string().min(10, "Напиши поне 10 знака."),
    ),
  })
  .strict();

/** Public name: first name and the initial of the last ("Иван П."). */
export function reviewAuthorName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Клиент";
  const first = parts[0].slice(0, 40);
  return parts.length > 1
    ? `${first} ${parts.at(-1)![0].toUpperCase()}.`
    : first;
}

/** A delivered order of the customer containing the product, if any. */
async function deliveredOrderWith(
  db: Queryable,
  customerId: string,
  sku: string,
): Promise<string | null> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM orders
     WHERE customer_id = $1 AND status = 'delivered'
       AND lines @> jsonb_build_array(jsonb_build_object('sku', $2::text))
     ORDER BY delivered_at DESC LIMIT 1`,
    [customerId, sku],
  );
  return result.rows[0]?.id ?? null;
}

export type ReviewEligibility =
  "can-review" | "already-reviewed" | "not-purchased";

export async function reviewEligibility(
  customerId: string,
  sku: string,
  db: Queryable = database(),
): Promise<ReviewEligibility> {
  const existing = await db.query(
    "SELECT 1 FROM product_reviews WHERE customer_id = $1 AND sku = $2",
    [customerId, sku],
  );
  if (existing.rowCount) return "already-reviewed";
  return (await deliveredOrderWith(db, customerId, sku))
    ? "can-review"
    : "not-purchased";
}

export async function submitReview(
  customer: { id: string; name: string },
  sku: string,
  input: z.infer<typeof reviewSchema>,
): Promise<string> {
  const db = database();
  const orderId = await deliveredOrderWith(db, customer.id, sku);
  if (!orderId)
    throw new ReviewError(
      "Отзив може да остави само клиент, получил този продукт.",
      403,
    );
  const id = randomUUID();
  try {
    await db.query(
      `INSERT INTO product_reviews(id, sku, customer_id, order_id, author_name, rating, title, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        sku,
        customer.id,
        orderId,
        reviewAuthorName(customer.name),
        input.rating,
        input.title,
        input.body,
      ],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new ReviewError("Вече си оставил(а) отзив за този продукт.", 409);
    throw error;
  }
  return id;
}

export type PublishedReview = {
  authorName: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
};
export type ReviewSummary = { count: number; average: number | null };

export async function publishedReviews(
  sku: string,
  limit = 20,
  db: Queryable = database(),
): Promise<{ reviews: PublishedReview[]; summary: ReviewSummary }> {
  const [rows, summary] = await Promise.all([
    db.query<PublishedReview & { createdAt: Date }>(
      `SELECT author_name AS "authorName", rating, title, body, created_at AS "createdAt"
       FROM product_reviews WHERE sku = $1 AND status = 'published'
       ORDER BY created_at DESC LIMIT $2`,
      [sku, limit],
    ),
    db.query<{ count: number; average: string | null }>(
      `SELECT count(*)::int AS count, round(avg(rating), 1)::text AS average
       FROM product_reviews WHERE sku = $1 AND status = 'published'`,
      [sku],
    ),
  ]);
  return {
    reviews: rows.rows.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt).toISOString(),
    })),
    summary: {
      count: summary.rows[0].count,
      average:
        summary.rows[0].average === null
          ? null
          : Number(summary.rows[0].average),
    },
  };
}

export type PendingReview = PublishedReview & {
  id: string;
  sku: string;
  status: "pending" | "published" | "rejected";
};

export async function reviewsForModeration(
  status: "pending" | "published" | "rejected" = "pending",
): Promise<PendingReview[]> {
  const result = await database().query(
    `SELECT id, sku, status, author_name AS "authorName", rating, title, body,
            created_at AS "createdAt"
     FROM product_reviews WHERE status = $1
     ORDER BY created_at ${status === "pending" ? "ASC" : "DESC"} LIMIT 200`,
    [status],
  );
  return result.rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

export const moderationSchema = z
  .object({ action: z.enum(["publish", "reject"]) })
  .strict();

/** Publishes or rejects a review (also lets admins change their mind). */
export async function moderateReview(
  adminId: string,
  id: string,
  action: "publish" | "reject",
): Promise<void> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const status = action === "publish" ? "published" : "rejected";
    const updated = await client.query<{ sku: string; before: string }>(
      `UPDATE product_reviews r SET status = $2, moderated_at = now(), moderated_by = $3
       FROM product_reviews old WHERE r.id = $1 AND old.id = r.id
       RETURNING r.sku, old.status AS before`,
      [id, status, adminId],
    );
    if (!updated.rowCount) throw new ReviewError("Отзивът не е намерен.", 404);
    await client.query(
      `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
       VALUES ($1,$2,'review.moderate','product_review',$3,$4)`,
      [
        randomUUID(),
        adminId,
        id,
        JSON.stringify({
          sku: updated.rows[0].sku,
          from: updated.rows[0].before,
          to: status,
        }),
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
