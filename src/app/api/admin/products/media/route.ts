import { randomUUID } from "node:crypto";
import { z } from "zod";
import { currentCustomer, database } from "../../../../../lib/accounts";
import { json, requestJson } from "../../../../../lib/order-http";
import { invoiceError } from "../../../../../lib/invoice-http";
import {
  inspectProductMedia,
  mediaFilename,
  MAX_VIDEO_BYTES,
  MAX_PRODUCT_FILES,
  MAX_PRODUCT_BYTES,
} from "../../../../../lib/product-media-rules";
export const runtime = "nodejs";
const skuSchema = z.string().trim().min(1).max(120);
const selectColumns =
  "id,sku,kind,mime_type,filename,alt_text,sort_order,is_primary,octet_length(content) AS bytes";
export async function GET(request: Request) {
  try {
    if (!(await currentCustomer())?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    const sku = skuSchema.parse(new URL(request.url).searchParams.get("sku"));
    const media = await database().query(
      `SELECT ${selectColumns} FROM product_media WHERE sku=$1 ORDER BY sort_order,created_at`,
      [sku],
    );
    return json({ media: media.rows });
  } catch (e) {
    return invoiceError(e);
  }
}
export async function POST(request: Request) {
  try {
    const admin = await currentCustomer();
    if (!admin?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    const origin = new URL(request.headers.get("origin") || "about:blank");
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.host !== request.headers.get("host")
    )
      throw Error("Невалиден произход на заявката.");
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw Error("Избери файл за качване.");
    const reader = request.body?.getReader();
    if (!reader) throw Error("Липсва файл.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_VIDEO_BYTES + 65536) {
          await reader.cancel();
          throw Error("Снимките са до 10 MB, а видеата до 50 MB.");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type")! },
      body: Buffer.concat(chunks),
    }).formData();
    const sku = skuSchema.parse(form.get("sku"));
    const file = form.get("file");
    if (!(file instanceof File)) throw Error("Липсва файл.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = inspectProductMedia(bytes, file.type);
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const product = await client.query(
        "SELECT sku FROM warehouse_products WHERE sku=$1 FOR UPDATE",
        [sku],
      );
      if (!product.rowCount) throw Error("Непознат продукт.");
      const counts = await client.query(
        "SELECT count(*)::int AS count,coalesce(sum(octet_length(content)),0)::text AS bytes,coalesce(max(sort_order),-1) AS last FROM product_media WHERE sku=$1",
        [sku],
      );
      if (
        counts.rows[0].count >= MAX_PRODUCT_FILES ||
        Number(counts.rows[0].bytes) + bytes.length > MAX_PRODUCT_BYTES
      )
        throw Error("Лимитът е 12 файла и общо 100 MB за продукт.");
      const primary =
        kind === "image" &&
        !(
          await client.query(
            "SELECT id FROM product_media WHERE sku=$1 AND is_primary",
            [sku],
          )
        ).rowCount;
      await client.query(
        "INSERT INTO product_media(id,sku,kind,mime_type,filename,content,sort_order,is_primary,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          randomUUID(),
          sku,
          kind,
          file.type,
          mediaFilename(file.name),
          bytes,
          counts.rows[0].last + 1,
          primary,
          admin.id,
        ],
      );
      await client.query("COMMIT");
      return json({ saved: true }, 201);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    return invoiceError(e);
  }
}
const updateSchema = z
  .object({
    sku: skuSchema,
    id: z.uuid(),
    action: z.enum(["primary", "remove", "up", "down", "alt"]),
    alt: z
      .object({ bg: z.string().max(500), en: z.string().max(500) })
      .optional(),
  })
  .strict();
export async function PATCH(request: Request) {
  try {
    const admin = await currentCustomer();
    if (!admin?.isAdmin)
      return json({ error: "Нужен е администраторски достъп." }, 403);
    const data = updateSchema.parse(await requestJson(request));
    if (data.action === "alt" && !data.alt) throw Error("Невалидни данни.");
    const client = await database().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT sku FROM warehouse_products WHERE sku=$1 FOR UPDATE",
        [data.sku],
      );
      const result = await client.query(
        "SELECT id,kind,sort_order,is_primary FROM product_media WHERE id=$1 AND sku=$2",
        [data.id, data.sku],
      );
      const item = result.rows[0];
      if (!item) throw Error("Файлът не е намерен.");
      if (data.action === "primary") {
        if (item.kind !== "image")
          throw Error("Основният файл трябва да бъде снимка.");
        await client.query(
          "UPDATE product_media SET is_primary=false WHERE sku=$1 AND is_primary",
          [data.sku],
        );
        await client.query(
          "UPDATE product_media SET is_primary=true WHERE id=$1",
          [data.id],
        );
      }
      if (data.action === "remove") {
        await client.query("DELETE FROM product_media WHERE id=$1", [data.id]);
        if (item.is_primary)
          await client.query(
            "UPDATE product_media SET is_primary=true WHERE id=(SELECT id FROM product_media WHERE sku=$1 AND kind='image' ORDER BY sort_order,created_at LIMIT 1)",
            [data.sku],
          );
      }
      if (data.action === "alt")
        await client.query("UPDATE product_media SET alt_text=$2 WHERE id=$1", [
          data.id,
          JSON.stringify(data.alt),
        ]);
      if (data.action === "up" || data.action === "down") {
        const ordered = await client.query(
          "SELECT id FROM product_media WHERE sku=$1 ORDER BY sort_order,created_at",
          [data.sku],
        );
        const ids = ordered.rows.map((p) => p.id);
        const index = ids.indexOf(data.id);
        const next = index + (data.action === "up" ? -1 : 1);
        if (next >= 0 && next < ids.length) {
          [ids[index], ids[next]] = [ids[next], ids[index]];
          for (let n = 0; n < ids.length; n++)
            await client.query(
              "UPDATE product_media SET sort_order=$2 WHERE id=$1",
              [ids[n], n],
            );
        }
      }
      await client.query("COMMIT");
      return json({ saved: true });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    return invoiceError(e);
  }
}
