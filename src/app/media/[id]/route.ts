// Public product images (#44): /media/<id> serves an image of a published
// product from the database or object storage. Content never changes for
// an id (a replacement is a new id), so responses are cacheable forever by
// browsers and a CDN in front of the shop. Videos and drafts stay private
// (admins use /api/admin/products/media/<id>).
import { z } from "zod";
import { database } from "../../../lib/accounts";
import { readMedia } from "../../../lib/media-storage";

export const runtime = "nodejs";

const notFound = () =>
  new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return notFound();
  try {
    const result = await database().query<{
      content: Uint8Array | null;
      storage_key: string | null;
      mime_type: string;
    }>(
      `SELECT m.content, m.storage_key, m.mime_type
       FROM product_media m
       JOIN warehouse_products w ON w.sku = m.sku AND w.status = 'published'
       WHERE m.id = $1 AND m.kind = 'image'`,
      [id.data],
    );
    if (!result.rowCount) return notFound();
    const etag = `"${id.data}"`;
    const headers = {
      "Content-Type": result.rows[0].mime_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    const bytes = await readMedia(result.rows[0]);
    if (!bytes) return notFound();
    return new Response(new Uint8Array(bytes), {
      headers: { ...headers, "Content-Length": String(bytes.length) },
    });
  } catch (error) {
    console.error(
      "Media read failed",
      (error as { code?: string }).code ?? (error as Error).message,
    );
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
