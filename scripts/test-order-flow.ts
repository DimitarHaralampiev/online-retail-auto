import { shippingForSubtotal } from "../src/lib/shipping-price";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import pg from "pg";
import { sendOrderEmails } from "../src/lib/order-notifications";
import { database } from "../src/lib/accounts";
const root =
  process.env.TEST_APP_URL ?? process.env.APP_URL ?? "http://127.0.0.1:3008";
if (!["127.0.0.1", "localhost"].includes(new URL(root).hostname))
  throw new Error("Run this smoke test against the local development server.");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adminId = randomUUID();
const email = `orders-smoke-${adminId}@example.test`;
const session = randomBytes(32).toString("hex");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const ids: string[] = [];
async function post(
  path: string,
  body: unknown,
  extra: Record<string, string> = {},
) {
  const r = await fetch(root + path, {
    method: "POST",
    headers: { Origin: root, "Content-Type": "application/json", ...extra },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
}
const adminHeaders = { cookie: `auto_session=${session}` };
const input = {
  requestKey: randomUUID(),
  acknowledgeTest: true,
  expectedTotalCents: 2890,
  checkout: {
    items: [{ sku: "DEMO-001", quantity: 1 }],
    contact: { name: "Тест Клиент", email, phone: "0888123456" },
    delivery: {
      type: "address",
      courier: "speedy",
      city: "София",
      postalCode: "1000",
      street: "Тестова",
      number: "1",
      details: "",
    },
    payment: "cod",
  },
};
async function main() {
  try {
    const config = await (await fetch(root + "/api/checkout/config")).json();
    assert.equal(config.paymentProvider, "simulator");
    assert.equal(config.cardEnabled, true);
    input.expectedTotalCents =
      2390 +
      shippingForSubtotal(
        2390,
        config.shippingCents,
        config.freeShippingAboveCents,
      );
    await pool.query(
      "INSERT INTO customers(id,email,password_hash,name,phone,email_verified_at,is_admin) VALUES ($1,$2,$3,$4,$5,now(),true)",
      [
        adminId,
        email,
        "smoke-test-no-login",
        "Тест Администратор",
        "0888123456",
      ],
    );
    await pool.query(
      "INSERT INTO customer_sessions VALUES ($1,$2,now()+interval '1 hour')",
      [hash(session), adminId],
    );
    assert.equal(
      (await post("/api/orders", { ...input, expectedTotalCents: 1 })).status,
      400,
    );
    const created = await Promise.all([
      post("/api/orders", input),
      post("/api/orders", input),
    ]);
    assert.equal(created[0].status, 200);
    assert.equal(created[1].status, 200);
    assert.equal(created[0].data.id, created[1].data.id);
    const id = created[0].data.id;
    ids.push(id);
    const token = new URLSearchParams(
      new URL(created[0].data.trackingUrl).hash.slice(1),
    ).get("token")!;
    assert.equal((await fetch(root + `/api/orders/${id}`)).status, 404);
    assert.equal(
      (
        await fetch(root + `/api/orders/${id}`, {
          headers: { "x-order-token": token },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await post("/api/admin/orders", {
          id,
          status: "confirmed",
          expectedStatus: "received",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await post(
          "/api/admin/orders",
          { id, status: "ready", expectedStatus: "received" },
          adminHeaders,
        )
      ).status,
      400,
    );
    let expected = "received";
    for (const next of [
      "confirmed",
      "preparing",
      "ready",
      "handed_to_courier",
    ]) {
      if (next === "handed_to_courier")
        assert.equal(
          (
            await post(
              "/api/admin/orders",
              { id, status: next, expectedStatus: expected },
              adminHeaders,
            )
          ).status,
          400,
        );
      const changed = await post(
        "/api/admin/orders",
        {
          id,
          status: next,
          expectedStatus: expected,
          trackingNumber: "TEST-12345",
        },
        adminHeaders,
      );
      assert.equal(changed.status, 200);
      expected = next;
    }
    assert.equal(
      (
        await post(
          "/api/admin/orders",
          { id, status: "confirmed", expectedStatus: "received" },
          adminHeaders,
        )
      ).status,
      400,
    );
    const tracked = await (
      await fetch(root + `/api/orders/${id}`, {
        headers: { "x-order-token": token },
      })
    ).json();
    assert.equal(tracked.order.status, "handed_to_courier");
    assert.equal(tracked.history.length, 5);
    assert.equal(tracked.order.trackingNumber, "TEST-12345");
    assert.equal(tracked.order.paymentStatus, "due_on_delivery");
    assert.equal(tracked.order.access_hash, undefined);
    const card = await post("/api/orders", {
      ...input,
      requestKey: randomUUID(),
      checkout: { ...input.checkout, payment: "card" },
    });
    assert.equal(card.status, 200);
    const cardId = card.data.id;
    ids.push(cardId);
    const cardToken = new URLSearchParams(
      new URL(card.data.trackingUrl).hash.slice(1),
    ).get("token")!;
    const cardHeaders = { "x-order-token": cardToken };
    assert.equal(
      (
        await post(
          "/api/admin/orders",
          { id: cardId, status: "confirmed", expectedStatus: "received" },
          adminHeaders,
        )
      ).status,
      400,
    );
    assert.equal(
      (await post(`/api/orders/${cardId}/test-payment`, { outcome: "success" }))
        .status,
      404,
    );
    for (const outcome of ["failure", "success", "success", "failure"])
      assert.equal(
        (
          await post(
            `/api/orders/${cardId}/test-payment`,
            { outcome },
            cardHeaders,
          )
        ).status,
        200,
      );
    const paid = await (
      await fetch(root + `/api/orders/${cardId}`, { headers: cardHeaders })
    ).json();
    assert.equal(paid.order.paymentStatus, "paid");
    assert.equal(paid.order.status, "received");
    const emails = await pool.query(
      "SELECT count(*)::int AS count FROM order_email_outbox WHERE order_id=$1",
      [id],
    );
    assert.equal(emails.rows[0].count, 5);
    const paymentEmails = await pool.query(
      "SELECT count(*)::int AS count FROM order_email_outbox WHERE order_id=$1",
      [cardId],
    );
    assert.equal(paymentEmails.rows[0].count, 3);
    const owned = await post(
      "/api/orders",
      { ...input, requestKey: randomUUID() },
      adminHeaders,
    );
    assert.equal(owned.status, 200);
    ids.push(owned.data.id);
    assert.equal((await fetch(root + "/api/orders")).status, 401);
    const ownList = await (
      await fetch(root + "/api/orders", { headers: adminHeaders })
    ).json();
    assert.equal(ownList.orders.length, 1);
    assert.equal(ownList.orders[0].id, owned.data.id);
    assert.equal(
      (
        await fetch(root + `/api/orders/${owned.data.id}`, {
          headers: adminHeaders,
        })
      ).status,
      200,
    );
    assert.equal(
      (await fetch(root + `/api/orders/${owned.data.id}`)).status,
      404,
    );
    const retryId = randomUUID();
    await pool.query(
      "INSERT INTO order_email_outbox(id,order_id,recipient,subject,body) VALUES($1,$2,$3,$4,$5)",
      [retryId, id, email, "SMTP retry test", "Test-only notification"],
    );
    const port = process.env.SMTP_PORT;
    try {
      process.env.SMTP_PORT = "1";
      assert.equal(await sendOrderEmails(1, id), 0);
      const failed = await pool.query(
        "SELECT sent_at,attempts FROM order_email_outbox WHERE id=$1",
        [retryId],
      );
      assert.equal(failed.rows[0].sent_at, null);
      assert.equal(failed.rows[0].attempts, 1);
    } finally {
      if (port === undefined) delete process.env.SMTP_PORT;
      else process.env.SMTP_PORT = port;
    }
    await pool.query(
      "UPDATE order_email_outbox SET last_attempt_at=now()-interval '2 minutes' WHERE id=$1",
      [retryId],
    );
    assert.equal(await sendOrderEmails(1, id), 1);
    await database().end();
    console.log(
      "Order integration passed: concurrent deduplication, protected tracking, admin-only stages, handover number, COD, failed/successful card simulator and exactly-once queued notifications.",
    );
  } finally {
    if (ids.length)
      await pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM customers WHERE id=$1", [adminId]);
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
