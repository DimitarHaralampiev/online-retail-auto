import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logError } from "./log";
export const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
/** Throws unless the request comes from this site (state-changing routes). */
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  let valid = false;
  try {
    const parsed = new URL(origin ?? "");
    valid =
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.host === request.headers.get("host");
  } catch {}
  if (!valid) throw new Error("Невалиден произход на заявката.");
}
export async function requestJson(request: Request, maxBytes = 16384) {
  requireSameOrigin(request);
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("Изпрати данните като JSON.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Липсват данни.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Заявката е твърде голяма.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Невалидни данни.");
  }
}
export function orderError(error: unknown) {
  if (error instanceof ZodError)
    return json({ error: error.issues[0]?.message ?? "Провери данните." }, 400);
  const e = error as { code?: string; message?: string };
  if (!e.code && e.message && /^[А-Я]/u.test(e.message))
    return json({ error: e.message }, 400);
  void logError("Order service failed", e);
  return json(
    { error: "Поръчките временно не са достъпни. Опитай отново." },
    503,
  );
}
