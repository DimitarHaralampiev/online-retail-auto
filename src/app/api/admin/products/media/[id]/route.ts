import { currentCustomer, database } from "../../../../../../lib/accounts";
import { json } from "../../../../../../lib/order-http";
import { parseMediaRange } from "../../../../../../lib/product-media-rules";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await currentCustomer())?.isAdmin)
    return json({ error: "Нужен е администраторски достъп." }, 403);
  const parsed = z.uuid().safeParse((await params).id);
  if (!parsed.success) return new Response(null, { status: 404 });
  const result = await database().query(
    "SELECT content,mime_type FROM product_media WHERE id=$1",
    [parsed.data],
  );
  if (!result.rowCount) return new Response(null, { status: 404 });
  const file = result.rows[0];
  const bytes: Buffer = file.content;
  const headers = {
    "Content-Type": file.mime_type,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  const range = request.headers.get("range");
  if (range) {
    const parsed = parseMediaRange(range, bytes.length);
    if (!parsed)
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${bytes.length}` },
      });
    const part = bytes.subarray(parsed.start, parsed.end + 1);
    return new Response(new Uint8Array(part), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(part.length),
        "Content-Range": `bytes ${parsed.start}-${parsed.end}/${bytes.length}`,
      },
    });
  }
  return new Response(new Uint8Array(bytes), {
    headers: { ...headers, "Content-Length": String(bytes.length) },
  });
}
