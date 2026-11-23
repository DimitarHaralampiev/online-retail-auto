import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import {
  moderateReview,
  publishedReviews,
  reviewAuthorName,
  reviewEligibility,
  ReviewError,
  reviewSchema,
  reviewsForModeration,
  submitReview,
} from "../../src/lib/reviews";
import { insertCustomer, setupTestDatabase } from "./database";

let buyer = { id: "", name: "Мария Иванова" };
let other = { id: "", name: "Петър" };
let admin = "";
const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    buyer = { ...buyer, id: await insertCustomer(pool) };
    other = { ...other, id: await insertCustomer(pool) };
    admin = await insertCustomer(pool, { isAdmin: true });
  },
});

async function order(customer: string, status: string, sku = "DEMO-003") {
  const id = randomUUID();
  await db().pool.query(
    `INSERT INTO orders(id,mode,customer_id,request_key,request_hash,access_hash,contact,delivery,destination,lines,subtotal_cents,shipping_cents,total_cents,currency,payment_method,payment_status,status,delivered_at)
     VALUES($1,'test',$2,$3,'h','a','{"name":"x","email":"x@example.test","phone":"0888"}','{"type":"address","courier":"speedy"}','София',$4,1890,0,1890,'eur','cod','due_on_delivery',$5,CASE WHEN $5='delivered' THEN now() END)`,
    [
      id,
      customer,
      randomUUID(),
      JSON.stringify([{ sku, name: "x", quantity: 1, unitPriceCents: 1890 }]),
      status,
    ],
  );
  return id;
}

const refused = (promise: Promise<unknown>, status: number, pattern: RegExp) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ReviewError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });

const review = (rating: number) =>
  reviewSchema.parse({
    rating,
    title: "Добър",
    body: "Пасна точно, качествен.",
  });

test("only buyers with a delivered order may review", async () => {
  await order(buyer.id, "handed_to_courier");
  assert.equal(
    await reviewEligibility(buyer.id, "DEMO-003", db().pool),
    "not-purchased",
  );
  await refused(
    submitReview(buyer, "DEMO-003", review(5)),
    403,
    /получил този продукт/,
  );
  await order(buyer.id, "delivered");
  assert.equal(
    await reviewEligibility(buyer.id, "DEMO-003", db().pool),
    "can-review",
  );
  // A delivered order of another product does not count.
  await order(other.id, "delivered", "DEMO-001");
  assert.equal(
    await reviewEligibility(other.id, "DEMO-003", db().pool),
    "not-purchased",
  );
});

test("a review waits for moderation; published ones drive the rating", async () => {
  const id = await submitReview(buyer, "DEMO-003", review(4));
  assert.equal(
    await reviewEligibility(buyer.id, "DEMO-003", db().pool),
    "already-reviewed",
  );
  // Pending reviews are not shown and do not count.
  assert.deepEqual(
    (await publishedReviews("DEMO-003", 20, db().pool)).summary,
    { count: 0, average: null },
  );
  assert.deepEqual(
    (await reviewsForModeration()).map((r) => r.id),
    [id],
  );
  await moderateReview(admin, id, "publish");
  const shown = await publishedReviews("DEMO-003", 20, db().pool);
  assert.deepEqual(shown.summary, { count: 1, average: 4 });
  assert.equal(shown.reviews[0].authorName, "Мария И.");
  assert.equal(shown.reviews[0].body, "Пасна точно, качествен.");
  const audit = await db().pool.query(
    "SELECT details FROM admin_audit_log WHERE entity_id=$1",
    [id],
  );
  assert.deepEqual(audit.rows[0].details, {
    sku: "DEMO-003",
    from: "pending",
    to: "published",
  });
});

test("one review per product, also under a race", async () => {
  await refused(
    submitReview(buyer, "DEMO-003", review(1)),
    409,
    /Вече си оставил/,
  );
  const twice = await Promise.allSettled([
    submitReview(other, "DEMO-001", review(5)),
    submitReview(other, "DEMO-001", review(5)),
  ]);
  assert.equal(twice.filter((r) => r.status === "fulfilled").length, 1);
});

test("rejecting hides a review and can be reversed", async () => {
  const [pending] = await reviewsForModeration();
  await moderateReview(admin, pending.id, "reject");
  assert.equal(
    (await publishedReviews("DEMO-001", 20, db().pool)).summary.count,
    0,
  );
  await moderateReview(admin, pending.id, "publish");
  assert.equal(
    (await publishedReviews("DEMO-001", 20, db().pool)).summary.count,
    1,
  );
  await refused(
    moderateReview(admin, randomUUID(), "publish"),
    404,
    /не е намерен/,
  );
});

test("input is validated and names are shortened", () => {
  for (const bad of [
    { rating: 0, body: "достатъчно дълъг текст" },
    { rating: 6, body: "достатъчно дълъг текст" },
    { rating: 3, body: "кратко" },
    { rating: 3, body: "a\u0000 достатъчно дълъг" },
    { rating: 3.5, body: "достатъчно дълъг текст" },
  ])
    assert.throws(() => reviewSchema.parse(bad), JSON.stringify(bad));
  assert.equal(reviewAuthorName("  Иван  Петров Георгиев "), "Иван Г.");
  assert.equal(reviewAuthorName("Мария"), "Мария");
  assert.equal(reviewAuthorName(""), "Клиент");
});
