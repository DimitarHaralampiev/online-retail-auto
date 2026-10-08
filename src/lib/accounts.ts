import { Pool } from "pg";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { tokenHash } from "./password";
import type { Customer } from "./account-schema";
const globalDb = globalThis as typeof globalThis & { accountPool?: Pool };
export function database() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Профилите още не са конфигурирани. Можеш да продължиш като гост.",
    );
  return (globalDb.accountPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  }));
}
export const sessionCookie = "auto_session";
export async function currentCustomer(): Promise<Customer | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await database().query(
    `SELECT c.id,c.email,c.name,c.phone,c.delivery FROM customers c JOIN customer_sessions s ON s.customer_id=c.id WHERE s.token_hash=$1 AND s.expires_at>now()`,
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}
export async function createSession(customerId: string) {
  const jar = await cookies();
  const previous = jar.get(sessionCookie)?.value;
  if (previous)
    await database().query(
      "DELETE FROM customer_sessions WHERE token_hash=$1",
      [tokenHash(previous)],
    );
  const token = randomBytes(32).toString("hex");
  await database().query(
    "INSERT INTO customer_sessions VALUES ($1,$2,now()+interval '7 days')",
    [tokenHash(token), customerId],
  );
  jar.set(sessionCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 604800,
  });
}
