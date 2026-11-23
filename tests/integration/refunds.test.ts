import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beforeEach, test } from "node:test";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import type { OrderRecord } from "../../src/lib/order-model";
import {
  checkoutPayment,
  recordPaymentEvent,
  type PaymentSession,
} from "../../src/lib/order-payments";
import { createOrder } from "../../src/lib/orders";
import {
  completeRefund,
  openRefunds,
  recordPayment,
  RefundError,
} from "../../src/lib/refunds";
import { releaseExpiredReservations } from "../../src/lib/stock-reservations";
import { insertCustomer, setupTestDatabase } from "./database";

Object.assign(process.env, {
  CATALOG_SOURCE: "postgres",
  ORDERS_MODE: "test",
  TEST_SHIPPING_CENTS: "500",
  FREE_SHIPPING_ABOVE_CENTS: "3000",
  APP_URL: "http://localhost:3000",
  PAYMENT_PROVIDER: "simulator",
  ORDER_TRACKING_SECRET: "d".repeat(64),
});
const db = setupTestDatabase();
const TOTAL = 1890 + 500;

beforeEach(async () => {
  await db().pool.query(
    "TRUNCATE orders, warehouse_products, product_categories, promotions CASCADE",
  );
  const client = await db().pool.connect();
  try {
    await seedDemoCatalog(client);
  } finally {
    client.release();
  }
});

const cardOrder = () =>
  createOrder(
    {
      requestKey: randomUUID(),
      expectedTotalCents: TOTAL,
      acknowledgeTest: true,
      checkout: {
        items: [{ sku: "DEMO-003", quantity: 1 }],
        contact: {
          name: "Иван Петров",
          email: "refund@example.test",
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
        payment: "card",
      },
    },
    null,
  );

const orderRecord = async (id: string) =>
  (
    await db().pool.query<OrderRecord>("SELECT * FROM orders WHERE id = $1", [
      id,
    ])
  ).rows[0];

function paidEvent(orderId: string, eventId = `evt_${randomUUID()}`) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: `cs_test_${orderId}`,
        livemode: false,
        currency: "eur",
        amount_total: TOTAL,
        payment_status: "paid",
        metadata: { orderId },
        client_reference_id: orderId,
      },
    },
  } as unknown as Parameters<typeof recordPaymentEvent>[0];
}

async function cancelByExpiry(id: string) {
  await db().pool.query(
    "UPDATE orders SET stripe_session_id = $1 WHERE id = $2",
    [`cs_test_${id}`, id],
  );
  await db().pool.query(
    "UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = $1",
    [id],
  );
  assert.equal(await releaseExpiredReservations(db().pool), 1);
}

test("a normal card payment is recorded once and owes nothing", async () => {
  const order = await cardOrder();
  await db().pool.query(
    "UPDATE orders SET stripe_session_id = $1 WHERE id = $2",
    [`cs_test_${order.id}`, order.id],
  );
  const event = paidEvent(order.id);
  await recordPaymentEvent(event);
  await recordPaymentEvent(event); // webhook retry
  const payments = await db().pool.query(
    "SELECT provider, external_reference, amount_cents, status FROM payments WHERE order_id = $1",
    [order.id],
  );
  assert.deepEqual(payments.rows, [
    {
      provider: "stripe",
      external_reference: `cs_test_${order.id}`,
      amount_cents: TOTAL,
      status: "paid",
    },
  ]);
  assert.deepEqual(await openRefunds(), []);
});

test("a payment for a cancelled order queues exactly one refund", async () => {
  const order = await cardOrder();
  await cancelByExpiry(order.id);
  await recordPaymentEvent(paidEvent(order.id));
  // A second delivery of the same payment under another event id.
  await recordPaymentEvent(paidEvent(order.id));
  const open = await openRefunds();
  assert.equal(open.length, 1);
  assert.deepEqual(
    { ...open[0], id: undefined, requestedAt: undefined },
    {
      id: undefined,
      requestedAt: undefined,
      orderId: order.id,
      amountCents: TOTAL,
      reason: "paid_after_cancel",
      paidWith: "stripe",
      paymentReference: `cs_test_${order.id}`,
      email: "refund@example.test",
    },
  );
  assert.equal((await orderRecord(order.id)).status, "cancelled");
});

test("an admin marks a refund as paid back, once, with an audit entry", async () => {
  const admin = await insertCustomer(db().pool, { isAdmin: true });
  const order = await cardOrder();
  await cancelByExpiry(order.id);
  await recordPaymentEvent(paidEvent(order.id));
  const [refund] = await openRefunds();
  await completeRefund(admin, refund.id, "Върнато в Stripe");
  assert.deepEqual(await openRefunds(), []);
  const stored = (
    await db().pool.query(
      "SELECT status, actor_id, note, completed_at IS NOT NULL AS done FROM refunds WHERE id = $1",
      [refund.id],
    )
  ).rows[0];
  assert.deepEqual(stored, {
    status: "succeeded",
    actor_id: admin,
    note: "Върнато в Stripe",
    done: true,
  });
  const audit = await db().pool.query(
    "SELECT action, details FROM admin_audit_log WHERE entity_id = $1",
    [refund.id],
  );
  assert.equal(audit.rows[0].action, "refund.complete");
  assert.equal(audit.rows[0].details.amountCents, TOTAL);
  await assert.rejects(
    completeRefund(admin, refund.id, ""),
    (e) => e instanceof RefundError && e.status === 409,
  );
  await assert.rejects(
    completeRefund(admin, randomUUID(), ""),
    (e) => e instanceof RefundError && e.status === 404,
  );
});

test("recording the same payment twice keeps one ledger row", async () => {
  const order = await cardOrder();
  const client = await db().pool.connect();
  try {
    const payment = {
      orderId: order.id,
      provider: "simulator" as const,
      reference: `simulator-${order.id}`,
      amountCents: TOTAL,
    };
    const first = await recordPayment(client, payment);
    assert.equal(await recordPayment(client, payment), first);
  } finally {
    client.release();
  }
});

/** checkoutPayment as with Stripe (orders are created with the simulator). */
async function withStripe<T>(fn: () => Promise<T>): Promise<T> {
  process.env.PAYMENT_PROVIDER = "stripe";
  try {
    return await fn();
  } finally {
    process.env.PAYMENT_PROVIDER = "simulator";
  }
}

test("a payment session is attached only while the order can still be paid", async () => {
  const create = async (
    order: OrderRecord,
    expiresAt: number,
  ): Promise<PaymentSession> => ({
    id: `cs_test_${order.id}`,
    url: `https://checkout.example.test/${order.id}`,
    expires_at: expiresAt,
    livemode: false,
  });
  // Payable: the session is stored and the stock held past its lifetime.
  const payable = await cardOrder();
  const record = await orderRecord(payable.id);
  assert.equal(
    await withStripe(() => checkoutPayment(record, create)),
    `https://checkout.example.test/${payable.id}`,
  );
  assert.equal(
    (await orderRecord(payable.id)).stripe_session_id,
    `cs_test_${payable.id}`,
  );
  const hold = await db().pool.query(
    "SELECT expires_at > now() + interval '35 minutes' AS past_session FROM stock_reservations WHERE order_id = $1",
    [payable.id],
  );
  assert.equal(hold.rows[0].past_session, true);

  // Cancelled by the expiry job while the session was being created.
  const racing = await cardOrder();
  const snapshot = await orderRecord(racing.id);
  await cancelByExpiry(racing.id);
  await db().pool.query(
    "UPDATE orders SET stripe_session_id = NULL WHERE id = $1",
    [racing.id],
  );
  assert.equal(await withStripe(() => checkoutPayment(snapshot, create)), null);
  const cancelled = await orderRecord(racing.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.stripe_session_id, null);
  assert.equal(cancelled.payment_url, null);
  const released = await db().pool.query(
    "SELECT status FROM stock_reservations WHERE order_id = $1",
    [racing.id],
  );
  assert.deepEqual(
    released.rows.map((r) => r.status),
    ["expired"],
    "not extended",
  );

  // Another session already stored: its link is kept.
  const twice = await cardOrder();
  await db().pool.query(
    "UPDATE orders SET stripe_session_id = 'cs_test_other', payment_url = 'https://checkout.example.test/other' WHERE id = $1",
    [twice.id],
  );
  const older = { ...(await orderRecord(twice.id)), payment_url: null };
  assert.equal(
    await withStripe(() => checkoutPayment(older, create)),
    "https://checkout.example.test/other",
  );
});
