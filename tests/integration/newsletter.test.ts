import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONSENT_TEXT,
  confirmSubscription,
  subscribe,
  unsubscribe,
  type NewsletterMail,
} from "../../src/lib/newsletter";
import { setupTestDatabase } from "./database";

process.env.APP_URL = "http://localhost:3000";
const db = setupTestDatabase();
const mailbox: NewsletterMail[] = [];
const send = async (mail: NewsletterMail) => {
  mailbox.push(mail);
};
const token = (link: string) => new URL(link).hash.replace("#token=", "");
const row = async (email: string) =>
  (
    await db().pool.query(
      "SELECT * FROM newsletter_subscribers WHERE email=$1",
      [email],
    )
  ).rows[0];
const expireCooldown = () =>
  db().pool.query(
    "UPDATE newsletter_subscribers SET last_sent_at = now() - interval '2 minutes'",
  );

test("subscribing is pending until confirmed, with the consent recorded", async () => {
  assert.equal(await subscribe("ana@example.test", "en", send), "sent");
  const mail = mailbox.at(-1)!;
  assert.match(
    mail.confirmLink,
    /^http:\/\/localhost:3000\/newsletter\/confirm#token=[a-f0-9]{64}$/,
  );
  assert.match(mail.unsubscribeLink, /\/newsletter\/unsubscribe#token=/);
  let stored = await row("ana@example.test");
  assert.equal(stored.status, "pending");
  assert.equal(stored.consent_text, CONSENT_TEXT.en);
  assert.equal(stored.consent_locale, "en");
  assert.notEqual(
    stored.confirm_token_hash,
    token(mail.confirmLink),
    "only the hash is stored",
  );
  assert.equal(await confirmSubscription(token(mail.confirmLink)), true);
  stored = await row("ana@example.test");
  assert.equal(stored.status, "confirmed");
  assert.ok(stored.confirmed_at);
  // The confirmation link works once.
  assert.equal(await confirmSubscription(token(mail.confirmLink)), false);
});

test("a confirmed address is left alone; repeated requests are limited", async () => {
  const before = mailbox.length;
  assert.equal(await subscribe("ana@example.test", "bg", send), "skipped");
  assert.equal(mailbox.length, before);
  assert.equal(await subscribe("bo@example.test", "bg", send), "sent");
  assert.equal(
    await subscribe("bo@example.test", "bg", send),
    "skipped",
    "cooldown",
  );
  for (let i = 0; i < 4; i++) {
    await expireCooldown();
    assert.equal(await subscribe("bo@example.test", "bg", send), "sent");
  }
  await expireCooldown();
  assert.equal(
    await subscribe("bo@example.test", "bg", send),
    "skipped",
    "daily cap",
  );
});

test("unsubscribing works from any email and allows subscribing again", async () => {
  const mail = mailbox.find((m) => m.to === "ana@example.test")!;
  assert.equal(await unsubscribe(token(mail.unsubscribeLink)), true);
  assert.equal((await row("ana@example.test")).status, "unsubscribed");
  // Idempotent.
  assert.equal(await unsubscribe(token(mail.unsubscribeLink)), true);
  await expireCooldown();
  assert.equal(await subscribe("ana@example.test", "bg", send), "sent");
  assert.equal((await row("ana@example.test")).status, "pending");
});

test("expired, malformed and unknown links do nothing", async () => {
  await subscribe("cvet@example.test", "bg", send);
  const mail = mailbox.at(-1)!;
  await db().pool.query(
    "UPDATE newsletter_subscribers SET confirm_expires_at = now() - interval '1 second' WHERE email='cvet@example.test'",
  );
  assert.equal(await confirmSubscription(token(mail.confirmLink)), false);
  assert.equal((await row("cvet@example.test")).status, "pending");
  assert.equal(await confirmSubscription("nope"), false);
  assert.equal(await unsubscribe("f".repeat(64)), false);
});

test("a failed email stores nothing", async () => {
  await assert.rejects(
    subscribe("dim@example.test", "bg", async () => {
      throw new Error("SMTP down");
    }),
    /SMTP down/,
  );
  assert.equal(await row("dim@example.test"), undefined);
});
