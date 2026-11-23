// Newsletter with double opt-in (#50). Subscribing stores the consent wording
// and sends a confirmation link; only a confirmed address is subscribed.
// Links carry random tokens in the URL fragment (only hashes are stored):
// confirmation expires after CONFIRM_DAYS, unsubscribing works any time.
// Requests never reveal whether an address is already subscribed.
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { database } from "./accounts";
import { credentialsSchema } from "./account-schema";
import type { Locale } from "./i18n/locale";
import { tokenHash } from "./password";
import { CONSENT_TEXT } from "./newsletter-text";

export { CONSENT_TEXT };
import { mailTransport, verificationTokenValid } from "./verification";

export const CONFIRM_DAYS = 7;
const COOLDOWN_SECONDS = 60;
const MAX_PER_DAY = 5;

export const subscribeSchema = z
  .object({
    email: credentialsSchema.shape.email,
    consent: z.literal(true, "Потвърди съгласието си."),
  })
  .strict();
export const tokenSchema = z
  .object({
    token: z.string().refine(verificationTokenValid, "Невалиден линк."),
  })
  .strict();

function link(path: string, token: string): string {
  const base = new URL(process.env.APP_URL ?? "");
  if (
    base.username ||
    base.password ||
    (base.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && base.protocol === "http:"))
  )
    throw new Error("Configure APP_URL with HTTPS in production");
  return new URL(`${path}#token=${token}`, base).toString();
}

export type NewsletterMail = {
  to: string;
  locale: Locale;
  confirmLink: string;
  unsubscribeLink: string;
};

async function sendConfirmation(mail: NewsletterMail) {
  const bg = mail.locale === "bg";
  await mailTransport().sendMail({
    from: process.env.SMTP_FROM,
    to: mail.to,
    subject: bg
      ? "Потвърди абонамента — AUTO/SHOP"
      : "Confirm your subscription — AUTO/SHOP",
    text: bg
      ? `Получихме заявка за абонамент за новините на AUTO/SHOP.\n\nПотвърди абонамента чрез този линк (валиден ${CONFIRM_DAYS} дни):\n${mail.confirmLink}\n\nАко не си се абонирал(а), игнорирай писмото — няма да получаваш новини.\n\nОтписване по всяко време: ${mail.unsubscribeLink}`
      : `We received a request to subscribe to AUTO/SHOP news.\n\nConfirm it with this link (valid for ${CONFIRM_DAYS} days):\n${mail.confirmLink}\n\nIf you did not subscribe, ignore this email — you will not receive news.\n\nUnsubscribe at any time: ${mail.unsubscribeLink}`,
  });
}

/**
 * Starts (or restarts) a subscription and emails a confirmation link, within
 * the send limits. Confirmed addresses are left as they are. Callers answer
 * the visitor the same way in every case.
 */
export async function subscribe(
  email: string,
  locale: Locale,
  send: (mail: NewsletterMail) => Promise<void> = sendConfirmation,
): Promise<"sent" | "skipped"> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{
      id: string;
      status: string;
      cooldown: boolean;
      in_window: boolean;
      send_count: number;
    }>(
      `SELECT id, status,
              coalesce(last_sent_at > now() - make_interval(secs => $2), false) AS cooldown,
              window_started_at > now() - interval '24 hours' AS in_window, send_count
       FROM newsletter_subscribers WHERE email = $1 FOR UPDATE`,
      [email, COOLDOWN_SECONDS],
    );
    const row = existing.rows[0];
    if (
      row?.status === "confirmed" ||
      row?.cooldown ||
      (row?.in_window && row.send_count >= MAX_PER_DAY)
    ) {
      await client.query("COMMIT");
      return "skipped";
    }
    const confirm = randomBytes(32).toString("hex");
    const unsubscribe = randomBytes(32).toString("hex");
    await client.query(
      `INSERT INTO newsletter_subscribers(id, email, status, confirm_token_hash,
         confirm_expires_at, unsubscribe_token_hash, consent_text, consent_locale,
         last_sent_at, send_count)
       VALUES ($1,$2,'pending',$3, now() + make_interval(days => $4), $5, $6, $7, now(), 1)
       ON CONFLICT (email) DO UPDATE SET
         status = 'pending', confirm_token_hash = EXCLUDED.confirm_token_hash,
         confirm_expires_at = EXCLUDED.confirm_expires_at,
         unsubscribe_token_hash = EXCLUDED.unsubscribe_token_hash,
         consent_text = EXCLUDED.consent_text, consent_locale = EXCLUDED.consent_locale,
         requested_at = now(), confirmed_at = NULL, unsubscribed_at = NULL,
         last_sent_at = now(),
         window_started_at = CASE WHEN newsletter_subscribers.window_started_at < now() - interval '24 hours'
           THEN now() ELSE newsletter_subscribers.window_started_at END,
         send_count = CASE WHEN newsletter_subscribers.window_started_at < now() - interval '24 hours'
           THEN 1 ELSE newsletter_subscribers.send_count + 1 END`,
      [
        randomUUID(),
        email,
        tokenHash(confirm),
        CONFIRM_DAYS,
        tokenHash(unsubscribe),
        CONSENT_TEXT[locale],
        locale,
      ],
    );
    await send({
      to: email,
      locale,
      confirmLink: link("/newsletter/confirm", confirm),
      unsubscribeLink: link("/newsletter/unsubscribe", unsubscribe),
    });
    await client.query("COMMIT");
    return "sent";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Confirms a pending subscription; false for unknown or expired links. */
export async function confirmSubscription(token: string): Promise<boolean> {
  if (!verificationTokenValid(token)) return false;
  const result = await database().query(
    `UPDATE newsletter_subscribers SET status = 'confirmed', confirmed_at = now(),
       confirm_token_hash = NULL, confirm_expires_at = NULL
     WHERE confirm_token_hash = $1 AND confirm_expires_at > now() AND status = 'pending'`,
    [tokenHash(token)],
  );
  return !!result.rowCount;
}

/** Unsubscribes the address of an unsubscribe link (idempotent). */
export async function unsubscribe(token: string): Promise<boolean> {
  if (!verificationTokenValid(token)) return false;
  const result = await database().query(
    `UPDATE newsletter_subscribers SET status = 'unsubscribed',
       unsubscribed_at = coalesce(unsubscribed_at, now()),
       confirm_token_hash = NULL, confirm_expires_at = NULL
     WHERE unsubscribe_token_hash = $1`,
    [tokenHash(token)],
  );
  return !!result.rowCount;
}
