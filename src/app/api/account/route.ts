import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  database,
  currentCustomer,
  createSession,
  sessionCookie,
} from "../../../lib/accounts";
import {
  credentialsSchema,
  registrationSchema,
  profileSchema,
} from "../../../lib/account-schema";
import { hashPassword, verifyPassword, tokenHash } from "../../../lib/password";
export const runtime = "nodejs";
const respond = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function GET() {
  try {
    return respond({ customer: await currentCustomer() });
  } catch {
    return respond({ error: "Профилите временно не са достъпни." }, 503);
  }
}
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  let allowed = false;
  try {
    const parsed = new URL(origin ?? "");
    allowed =
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.host === request.headers.get("host");
  } catch {}
  if (!allowed)
    return respond({ error: "Невалиден произход на заявката." }, 403);
  if (!request.headers.get("content-type")?.includes("application/json"))
    return respond({ error: "Очакваме JSON." }, 415);
  try {
    const reader = request.body?.getReader();
    if (!reader) return respond({ error: "Липсват данни." }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8192) {
          await reader.cancel();
          return respond({ error: "Твърде голяма заявка." }, 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return respond({ error: "Невалидни данни." }, 400);
    }
    if (data.action === "logout") {
      const jar = await cookies();
      const token = jar.get(sessionCookie)?.value;
      if (token)
        await database().query(
          "DELETE FROM customer_sessions WHERE token_hash=$1",
          [tokenHash(token)],
        );
      jar.delete(sessionCookie);
      return respond({ customer: null });
    }
    if (data.action === "profile") {
      const customer = await currentCustomer();
      if (!customer) return respond({ error: "Влез в профила си." }, 401);
      const profile = profileSchema.parse(data.profile);
      const result = await database().query(
        "UPDATE customers SET name=$1,phone=$2,delivery=$3 WHERE id=$4 RETURNING id,email,name,phone,delivery",
        [profile.name, profile.phone, profile.delivery, customer.id],
      );
      return respond({ customer: result.rows[0] });
    }
    if (data.action !== "login" && data.action !== "register")
      return respond({ error: "Непознато действие." }, 400);
    const credentials = (
      data.action === "register" ? registrationSchema : credentialsSchema
    ).parse(data.credentials);
    const key = tokenHash(credentials.email);
    const limit = await database().query(
      `INSERT INTO auth_attempts VALUES ($1,1,now()+interval '15 minutes') ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN auth_attempts.expires_at<now() THEN 1 ELSE auth_attempts.attempts+1 END, expires_at=CASE WHEN auth_attempts.expires_at<now() THEN now()+interval '15 minutes' ELSE auth_attempts.expires_at END RETURNING attempts`,
      [key],
    );
    if (limit.rows[0].attempts > 10)
      return respond(
        { error: "Твърде много опити. Опитай след 15 минути." },
        429,
      );
    let id: string;
    if (data.action === "register") {
      const profile = registrationSchema.parse(data.credentials);
      id = randomUUID();
      try {
        await database().query(
          "INSERT INTO customers (id,email,password_hash,name,phone) VALUES ($1,$2,$3,$4,$5)",
          [
            id,
            profile.email,
            await hashPassword(profile.password),
            profile.name,
            profile.phone,
          ],
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505")
          return respond(
            { error: "Не можем да създадем профил с тези данни. Опитай вход." },
            409,
          );
        throw e;
      }
    } else {
      const result = await database().query(
        "SELECT id,password_hash FROM customers WHERE email=$1",
        [credentials.email],
      );
      const valid = await verifyPassword(
        credentials.password,
        result.rows[0]?.password_hash ??
          `00000000000000000000000000000000:${"0".repeat(128)}`,
      );
      if (!result.rows[0] || !valid)
        return respond({ error: "Невалиден имейл или парола." }, 401);
      id = result.rows[0].id;
    }
    await createSession(id);
    return respond({ customer: await currentCustomer() });
  } catch (e) {
    if (e instanceof ZodError)
      return respond({ error: e.issues[0]?.message }, 400);
    console.error(
      "Account request failed",
      (e as { code?: string }).code ?? "configuration or service error",
    );
    return respond(
      {
        error: "Профилите временно не са достъпни. Можеш да поръчаш като гост.",
      },
      503,
    );
  }
}
