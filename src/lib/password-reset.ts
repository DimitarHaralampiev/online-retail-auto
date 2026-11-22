// Password recovery (#47). A reset link carries a random 256-bit token in
// the URL fragment (never sent to servers or in referrers); only its hash
// is stored, it expires after RESET_MINUTES and works once. Resetting signs
// the account out everywhere. Requests never reveal whether an account
// exists: the route answers the same way and does the work after replying.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { database } from "./accounts";
import { credentialsSchema } from "./account-schema";
import { hashPassword, tokenHash } from "./password";
import { mailTransport, verificationTokenValid } from "./verification";

export const RESET_MINUTES = 30;
const COOLDOWN_SECONDS = 60;
const MAX_PER_DAY = 5;

export const forgotSchema = z
  .object({ email: credentialsSchema.shape.email })
  .strict();
export const resetSchema = z
  .object({
    token: z.string().refine(verificationTokenValid, "Невалиден линк."),
    password: credentialsSchema.shape.password,
  })
  .strict();

export function resetLink(token: string): string {
  if (!verificationTokenValid(token)) throw new Error("Invalid reset token");
  const base = new URL(process.env.APP_URL ?? "");
  if (
    base.username ||
    base.password ||
    (base.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && base.protocol === "http:"))
  )
    throw new Error("Configure APP_URL with HTTPS in production");
  return new URL(`/account/reset#token=${token}`, base).toString();
}

/**
 * Emails a reset link when an account with this email exists and is within
 * the send limits; otherwise does nothing. Callers must not tell the
 * difference to the visitor.
 */
export async function requestPasswordReset(
  email: string,
  send: (to: string, link: string) => Promise<void> = sendResetEmail,
): Promise<"sent" | "skipped"> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query<{ id: string }>(
      "SELECT id FROM customers WHERE email = $1 FOR UPDATE",
      [email],
    );
    if (!customer.rowCount) {
      await client.query("COMMIT");
      return "skipped";
    }
    const id = customer.rows[0].id;
    const previous = await client.query<{
      cooldown: boolean;
      in_window: boolean;
      send_count: number;
    }>(
      `SELECT sent_at > now() - make_interval(secs => $2) AS cooldown,
              window_started_at > now() - interval '24 hours' AS in_window,
              send_count
       FROM password_resets WHERE customer_id = $1`,
      [id, COOLDOWN_SECONDS],
    );
    const record = previous.rows[0];
    if (
      record?.cooldown ||
      (record?.in_window && record.send_count >= MAX_PER_DAY)
    ) {
      await client.query("COMMIT");
      return "skipped";
    }
    const token = randomBytes(32).toString("hex");
    const link = resetLink(token);
    await client.query(
      `INSERT INTO password_resets
         VALUES ($1, $2, now() + make_interval(mins => $3), now(), now(), 1)
       ON CONFLICT (customer_id) DO UPDATE SET
         token_hash = EXCLUDED.token_hash,
         expires_at = EXCLUDED.expires_at,
         sent_at = now(),
         window_started_at = CASE WHEN password_resets.window_started_at < now() - interval '24 hours'
           THEN now() ELSE password_resets.window_started_at END,
         send_count = CASE WHEN password_resets.window_started_at < now() - interval '24 hours'
           THEN 1 ELSE password_resets.send_count + 1 END`,
      [id, tokenHash(token), RESET_MINUTES],
    );
    // Only a sent email makes the new token count (and replace the old one).
    await send(email, link);
    await client.query("COMMIT");
    return "sent";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function sendResetEmail(to: string, link: string) {
  await mailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Нова парола — AUTO/SHOP",
    text: `Поискана е нова парола за профила ти в AUTO/SHOP.\n\nЗадай нова парола чрез този линк:\n${link}\n\nЛинкът е валиден ${RESET_MINUTES} минути и може да се използва само веднъж. След смяната ще трябва да влезеш отново на всички устройства.\n\nАко не си поискал(а) нова парола, игнорирай това писмо — паролата ти остава същата.\n\n---\n\nA new password was requested for your AUTO/SHOP account. Set it here within ${RESET_MINUTES} minutes:\n${link}\n\nIf you did not ask for this, ignore this email.`,
  });
}

/**
 * Sets a new password with a valid, unexpired token. Signs the account out
 * on every device, clears login lockouts and confirms the email (the link
 * proves access to it). Returns false for unknown, used or expired tokens.
 */
export async function resetPassword(
  token: string,
  password: string,
): Promise<boolean> {
  if (!verificationTokenValid(token)) return false;
  const passwordHash = await hashPassword(password);
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const reset = await client.query<{ customer_id: string; email: string }>(
      `DELETE FROM password_resets r USING customers c
       WHERE r.token_hash = $1 AND r.expires_at > now() AND c.id = r.customer_id
       RETURNING r.customer_id, c.email`,
      [tokenHash(token)],
    );
    if (!reset.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    const { customer_id: id, email } = reset.rows[0];
    await client.query(
      `UPDATE customers SET password_hash = $2,
         email_verified_at = coalesce(email_verified_at, now())
       WHERE id = $1`,
      [id, passwordHash],
    );
    await client.query("DELETE FROM customer_sessions WHERE customer_id = $1", [
      id,
    ]);
    await client.query(
      "DELETE FROM email_verifications WHERE customer_id = $1",
      [id],
    );
    await client.query("DELETE FROM auth_attempts WHERE key = $1", [
      tokenHash(email),
    ]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
