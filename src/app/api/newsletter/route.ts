// Newsletter (#50): subscribe (double opt-in), confirm and unsubscribe.
// Subscribing answers the same way whether or not the address is known and
// does the work after replying.
import { after } from "next/server";
import { z } from "zod";
import { localeFromCookie, parseLocale } from "../../../lib/i18n/locale";
import {
  confirmSubscription,
  subscribe,
  subscribeSchema,
  tokenSchema,
  unsubscribe,
} from "../../../lib/newsletter";
import { json, requestJson } from "../../../lib/order-http";
import { clientKey, createRateLimiter } from "../../../lib/rate-limit";
import { logError } from "../../../lib/log";

export const runtime = "nodejs";

const subscribeLimiter = createRateLimiter(5, 15 * 60_000);
const tokenLimiter = createRateLimiter(20, 15 * 60_000);

export async function POST(request: Request) {
  try {
    const body = (await requestJson(request)) as { action?: unknown };
    if (body?.action === "subscribe") {
      if (!subscribeLimiter.take(clientKey(request)).allowed)
        return json(
          { error: "Твърде много заявки. Опитай след 15 минути." },
          429,
        );
      const {
        action: _action,
        locale: rawLocale,
        ...rest
      } = body as Record<string, unknown>;
      const { email } = subscribeSchema.parse(rest);
      const locale =
        rawLocale === undefined
          ? localeFromCookie(request.headers.get("cookie") ?? "")
          : parseLocale(rawLocale);
      after(() =>
        subscribe(email, locale).catch((e) =>
          logError("Newsletter confirmation failed", e),
        ),
      );
      return json({
        message:
          "Изпратихме ти имейл. Потвърди абонамента от линка в него (ако вече си абониран(а), нищо не се променя).",
      });
    }
    if (body?.action === "confirm" || body?.action === "unsubscribe") {
      if (!tokenLimiter.take(clientKey(request)).allowed)
        return json(
          { error: "Твърде много опити. Опитай след 15 минути." },
          429,
        );
      const { token } = tokenSchema.parse({
        token: (body as { token?: unknown }).token,
      });
      if (body.action === "confirm")
        return (await confirmSubscription(token))
          ? json({ message: "Абонаментът е потвърден. Благодарим!" })
          : json(
              {
                error: "Линкът е невалиден или е изтекъл. Абонирай се отново.",
              },
              400,
            );
      return (await unsubscribe(token))
        ? json({
            message: "Отписа се от новините. Няма да получаваш повече имейли.",
          })
        : json({ error: "Линкът за отписване е невалиден." }, 400);
    }
    return json({ error: "Непознато действие." }, 400);
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues[0]?.message ?? "Провери данните." },
        400,
      );
    const e = error as { code?: string; message?: string };
    if (!e.code && e.message && /^[А-Я]/u.test(e.message))
      return json({ error: e.message }, 400);
    void logError("Newsletter request failed", e);
    return json({ error: "Абонаментът временно не е достъпен." }, 503);
  }
}
