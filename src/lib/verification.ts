import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { smtpSettings } from "./mail-settings";
import { database } from "./accounts";
import { tokenHash } from "./password";
export const verificationTokenValid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function verificationLink(token: string) {
  if (!verificationTokenValid(token))
    throw new Error("Invalid verification token");
  const base = new URL(process.env.APP_URL ?? "");
  if (
    base.username ||
    base.password ||
    (base.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && base.protocol === "http:"))
  )
    throw new Error("Configure APP_URL with HTTPS in production");
  return new URL(`/account/verify#token=${token}`, base).toString();
}
export function mailTransport() {
  const { from, ...settings } = smtpSettings();
  return nodemailer.createTransport({
    ...settings,
    connectionTimeout: 10000,
    socketTimeout: 10000,
  });
}

export async function sendVerification(email: string) {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query(
      "SELECT id,email_verified_at FROM customers WHERE email=$1 FOR UPDATE",
      [email],
    );
    if (!customer.rows[0] || customer.rows[0].email_verified_at) {
      await client.query("COMMIT");
      return;
    }
    const id = customer.rows[0].id;
    const previous = await client.query(
      "SELECT *,sent_at>now()-interval '1 minute' AS cooldown,window_started_at>now()-interval '24 hours' AS in_window FROM email_verifications WHERE customer_id=$1",
      [id],
    );
    const record = previous.rows[0];
    if (record?.cooldown || (record?.in_window && record.send_count >= 5)) {
      await client.query("COMMIT");
      return;
    }
    const token = randomBytes(32).toString("hex");
    const link = verificationLink(token);
    await client.query(
      `INSERT INTO email_verifications VALUES ($1,$2,now()+interval '1 hour',now(),now(),1) ON CONFLICT(customer_id) DO UPDATE SET token_hash=$2,expires_at=now()+interval '1 hour',sent_at=now(),window_started_at=CASE WHEN email_verifications.window_started_at<now()-interval '24 hours' THEN now() ELSE email_verifications.window_started_at END,send_count=CASE WHEN email_verifications.window_started_at<now()-interval '24 hours' THEN 1 ELSE email_verifications.send_count+1 END`,
      [id, tokenHash(token)],
    );
    await mailTransport().sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: "Потвърди имейла си — AUTO/SHOP",
      text: `Добре дошъл в AUTO/SHOP!\n\nПотвърди имейла си чрез този линк:\n${link}\n\nЛинкът е валиден 1 час и може да се използва само веднъж. Ако не си създавал профил, игнорирай това писмо.`,
    });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function confirmEmail(token: unknown) {
  if (!verificationTokenValid(token)) return false;
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE customers SET email_verified_at=now() WHERE id=(SELECT customer_id FROM email_verifications WHERE token_hash=$1 AND expires_at>now()) AND email_verified_at IS NULL RETURNING id`,
      [tokenHash(token)],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("DELETE FROM email_verifications WHERE customer_id=$1", [
      result.rows[0].id,
    ]);
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function mailPreviewUrl() {
  return process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(process.env.SMTP_HOST ?? "") &&
    process.env.SMTP_PORT === "1025"
    ? "http://localhost:8025"
    : null;
}
