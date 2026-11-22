import assert from "node:assert/strict";
import { test } from "node:test";
import {
  requestPasswordReset,
  resetPassword,
} from "../../src/lib/password-reset";
import { tokenHash, verifyPassword } from "../../src/lib/password";
import { insertCustomer, setupTestDatabase } from "./database";

process.env.APP_URL = "http://localhost:3000";
const db = setupTestDatabase();

const mailbox: { to: string; link: string }[] = [];
const send = async (to: string, link: string) => {
  mailbox.push({ to, link });
};
const tokenOf = (link: string) => new URL(link).hash.replace("#token=", "");

test("unknown emails get nothing, and nothing is stored", async () => {
  assert.equal(
    await requestPasswordReset("nobody@example.test", send),
    "skipped",
  );
  assert.equal(mailbox.length, 0);
  const rows = await db().pool.query(
    "SELECT count(*)::int n FROM password_resets",
  );
  assert.equal(rows.rows[0].n, 0);
});

test("a reset link carries the token in the fragment; only its hash is stored", async () => {
  await insertCustomer(db().pool, { email: "anna@example.test" });
  assert.equal(await requestPasswordReset("anna@example.test", send), "sent");
  const { to, link } = mailbox.at(-1)!;
  assert.equal(to, "anna@example.test");
  assert.match(
    link,
    /^http:\/\/localhost:3000\/account\/reset#token=[a-f0-9]{64}$/,
  );
  const stored = await db().pool.query(
    "SELECT token_hash, expires_at > now() + interval '29 minutes' AS fresh FROM password_resets",
  );
  assert.equal(stored.rows[0].token_hash, tokenHash(tokenOf(link)));
  assert.equal(stored.rows[0].fresh, true);
});

test("cooldown, daily cap and replacement of the previous link", async () => {
  const { pool } = db();
  const first = tokenOf(mailbox.at(-1)!.link);
  assert.equal(
    await requestPasswordReset("anna@example.test", send),
    "skipped",
  );
  await pool.query(
    "UPDATE password_resets SET sent_at = now() - interval '2 minutes'",
  );
  assert.equal(await requestPasswordReset("anna@example.test", send), "sent");
  const second = tokenOf(mailbox.at(-1)!.link);
  assert.notEqual(first, second);
  // The replaced link no longer works.
  assert.equal(await resetPassword(first, "a brand new password"), false);
  for (let i = 0; i < 3; i++) {
    await pool.query(
      "UPDATE password_resets SET sent_at = now() - interval '2 minutes'",
    );
    assert.equal(await requestPasswordReset("anna@example.test", send), "sent");
  }
  await pool.query(
    "UPDATE password_resets SET sent_at = now() - interval '2 minutes'",
  );
  // Five links in 24 hours is the limit.
  assert.equal(
    await requestPasswordReset("anna@example.test", send),
    "skipped",
  );
});

test("resetting changes the password, signs out everywhere and works once", async () => {
  const { pool } = db();
  const id = await insertCustomer(pool, { email: "boris@example.test" });
  await pool.query(
    "UPDATE customers SET email_verified_at = NULL WHERE id = $1",
    [id],
  );
  await pool.query(
    "INSERT INTO customer_sessions VALUES ($1, $2, now() + interval '1 day'), ($3, $2, now() + interval '1 day')",
    [tokenHash("a"), id, tokenHash("b")],
  );
  await pool.query(
    "INSERT INTO auth_attempts VALUES ($1, 11, now() + interval '10 minutes')",
    [tokenHash("boris@example.test")],
  );
  await requestPasswordReset("boris@example.test", send);
  const token = tokenOf(mailbox.at(-1)!.link);
  assert.equal(
    await resetPassword(token, "correct horse battery staple"),
    true,
  );
  const customer = (
    await pool.query(
      "SELECT password_hash, email_verified_at FROM customers WHERE id = $1",
      [id],
    )
  ).rows[0];
  assert.equal(
    await verifyPassword(
      "correct horse battery staple",
      customer.password_hash,
    ),
    true,
  );
  assert.ok(customer.email_verified_at, "the link proves access to the email");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM customer_sessions WHERE customer_id = $1",
        [id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM auth_attempts WHERE key = $1", [
        tokenHash("boris@example.test"),
      ])
    ).rowCount,
    0,
  );
  // Single use.
  assert.equal(await resetPassword(token, "another new password"), false);
});

test("expired, malformed and unknown tokens are refused", async () => {
  const { pool } = db();
  await insertCustomer(pool, { email: "vera@example.test" });
  await requestPasswordReset("vera@example.test", send);
  const token = tokenOf(mailbox.at(-1)!.link);
  await pool.query(
    "UPDATE password_resets SET expires_at = now() - interval '1 second'",
  );
  assert.equal(await resetPassword(token, "a brand new password"), false);
  assert.equal(
    await resetPassword("not-a-token", "a brand new password"),
    false,
  );
  assert.equal(
    await resetPassword("f".repeat(64), "a brand new password"),
    false,
  );
});

test("a failed email leaves no usable link behind", async () => {
  const { pool } = db();
  const id = await insertCustomer(pool, { email: "georgi@example.test" });
  await assert.rejects(
    requestPasswordReset("georgi@example.test", async () => {
      throw new Error("SMTP down");
    }),
    /SMTP down/,
  );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM password_resets WHERE customer_id = $1", [
        id,
      ])
    ).rowCount,
    0,
  );
});
