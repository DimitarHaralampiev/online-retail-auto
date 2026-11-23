import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import {
  MAX_ATTEMPTS,
  outboxCounts,
  requeueFailed,
  retryDelaySeconds,
} from "../../src/lib/email-outbox";
import {
  orderOutbox,
  sendOrderEmails,
} from "../../src/lib/order-notifications";
import { createOrder } from "../../src/lib/orders";
import { runJob, withJobLock } from "../../src/lib/worker";
import { setupTestDatabase } from "./database";

Object.assign(process.env, {
  ORDERS_MODE: "test",
  TEST_SHIPPING_CENTS: "500",
  FREE_SHIPPING_ABOVE_CENTS: "3000",
  APP_URL: "http://localhost:3000",
  PAYMENT_PROVIDER: "simulator",
  ORDER_TRACKING_SECRET: "a".repeat(64),
});
const db = setupTestDatabase();

type Mail = { to: string; messageId: string };
const ok = (box: Mail[]) => async (mail: Mail) => {
  box.push(mail);
};
const failing = (error: unknown) => async () => {
  throw error;
};
const smtpDown = Object.assign(
  new Error("connect ECONNREFUSED 127.0.0.1:1025"),
  {
    code: "ECONNECTION",
  },
);

let orderId = "";
beforeEach(async () => {
  await db().pool.query("DELETE FROM order_email_outbox");
  const order = await createOrder(
    {
      requestKey: randomUUID(),
      expectedTotalCents: 2390,
      acknowledgeTest: true,
      checkout: {
        items: [{ sku: "DEMO-003", quantity: 1 }],
        contact: {
          name: "Иван Петров",
          email: "buyer@example.test",
          phone: "0888123456",
        },
        delivery: {
          type: "address",
          courier: "speedy",
          city: "София",
          postalCode: "1000",
          street: "ул. Тестова",
          number: "1",
          details: "",
        },
        payment: "cod",
      },
    },
    null,
  );
  orderId = order.id;
});

const row = async () =>
  (
    await db().pool.query(
      "SELECT attempts, sent_at, failed_at, last_error, locked_until, EXTRACT(EPOCH FROM next_attempt_at - now())::float AS wait FROM order_email_outbox WHERE order_id = $1",
      [orderId],
    )
  ).rows[0];
const makeDue = () =>
  db().pool.query("UPDATE order_email_outbox SET next_attempt_at = now()");

test("backoff doubles from a minute up to six hours", () => {
  assert.deepEqual([1, 2, 3, 4].map(retryDelaySeconds), [60, 120, 240, 480]);
  assert.equal(retryDelaySeconds(20), 6 * 3600);
});

test("a failed send is retried later, then delivered once", async () => {
  assert.equal(await sendOrderEmails(10, orderId, failing(smtpDown)), 0);
  let email = await row();
  assert.equal(email.attempts, 1);
  assert.equal(email.sent_at, null);
  assert.equal(email.failed_at, null);
  assert.equal(email.locked_until, null);
  assert.match(email.last_error, /ECONNECTION/);
  assert.ok(email.wait > 50 && email.wait <= 60, "retry in about a minute");
  // Not due yet: nothing is attempted.
  const box: Mail[] = [];
  assert.equal(await sendOrderEmails(10, orderId, ok(box)), 0);
  await makeDue();
  assert.equal(await sendOrderEmails(10, orderId, ok(box)), 1);
  email = await row();
  assert.equal(email.attempts, 2);
  assert.ok(email.sent_at);
  assert.equal(email.last_error, null);
  assert.equal(box.length, 1);
  assert.match(box[0].messageId, /^<[0-9a-f-]{36}@auto-shop\.invalid>$/);
  assert.equal(
    await sendOrderEmails(10, orderId, ok(box)),
    0,
    "sent emails stay sent",
  );
});

test("after the last attempt the email is parked as failed until requeued", async () => {
  await db().pool.query("UPDATE order_email_outbox SET attempts = $1", [
    MAX_ATTEMPTS - 1,
  ]);
  await sendOrderEmails(10, orderId, failing(smtpDown));
  let email = await row();
  assert.equal(email.attempts, MAX_ATTEMPTS);
  assert.ok(email.failed_at, "dead letter");
  assert.deepEqual(await outboxCounts("order_email_outbox"), {
    pending: 0,
    failed: 1,
  });
  await makeDue();
  const box: Mail[] = [];
  assert.equal(
    await sendOrderEmails(10, orderId, ok(box)),
    0,
    "failed emails are not retried",
  );
  assert.equal(await requeueFailed(orderOutbox), 1);
  email = await row();
  assert.equal(email.attempts, 0);
  assert.equal(email.failed_at, null);
  assert.deepEqual(await outboxCounts("order_email_outbox"), {
    pending: 1,
    failed: 0,
  });
  assert.equal(await sendOrderEmails(10, orderId, ok(box)), 1);
});

test("a rejected recipient fails at once, with personal data scrubbed", async () => {
  await sendOrderEmails(
    10,
    orderId,
    failing(
      Object.assign(new Error("550 5.1.1 <buyer@example.test>: user unknown"), {
        responseCode: 550,
      }),
    ),
  );
  const email = await row();
  assert.equal(email.attempts, 1);
  assert.ok(email.failed_at);
  assert.match(email.last_error, /^550 550 5\.1\.1 <\[email\]>: user unknown$/);
});

test("a lease left by a crashed worker expires and the email is retried", async () => {
  // A worker claimed the email and died before finishing.
  await db().pool.query(
    "UPDATE order_email_outbox SET attempts = 1, locked_until = now() + interval '5 minutes'",
  );
  const box: Mail[] = [];
  assert.equal(
    await sendOrderEmails(10, orderId, ok(box)),
    0,
    "leased elsewhere",
  );
  await db().pool.query(
    "UPDATE order_email_outbox SET locked_until = now() - interval '1 second'",
  );
  assert.equal(await sendOrderEmails(10, orderId, ok(box)), 1);
  assert.equal((await row()).attempts, 2);
});

test("concurrent senders deliver each email exactly once", async () => {
  const pool = db().pool;
  const order = (
    await pool.query("SELECT order_id FROM order_email_outbox LIMIT 1")
  ).rows[0];
  for (let i = 0; i < 9; i++)
    await pool.query(
      "INSERT INTO order_email_outbox(id, order_id, recipient, subject, body) VALUES ($1, $2, 'buyer@example.test', 's', 'b')",
      [randomUUID(), order.order_id],
    );
  const box: Mail[] = [];
  const slow = async (mail: Mail) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    box.push(mail);
  };
  const results = await Promise.all(
    [1, 2, 3].map(() => sendOrderEmails(10, undefined, slow)),
  );
  assert.equal(
    results.reduce((a, b) => a + b, 0),
    10,
  );
  assert.equal(new Set(box.map((m) => m.messageId)).size, 10);
});

test("a job runs only where its lock is free, and a failing job is contained", async () => {
  const pool = db().pool;
  let inner: unknown;
  const outer = await withJobLock(pool, "test-job", async () => {
    inner = await withJobLock(pool, "test-job", async () => "second");
    return "first";
  });
  assert.deepEqual(outer, { ran: true, result: "first" });
  assert.deepEqual(inner, { ran: false }, "another session holds the lock");
  assert.deepEqual(await withJobLock(pool, "test-job", async () => "again"), {
    ran: true,
    result: "again",
  });
  const original = console.error;
  console.error = () => {};
  try {
    await runJob(pool, {
      name: "broken",
      everyMs: 1,
      run: async () => {
        throw new Error("boom");
      },
    });
  } finally {
    console.error = original;
  }
  assert.deepEqual(
    await withJobLock(pool, "broken", async () => 1),
    { ran: true, result: 1 },
    "lock released",
  );
});
