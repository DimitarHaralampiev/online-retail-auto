// /sitemaps/products/N (#41): visible products PRODUCTS_PER_SITEMAP at a
// time, both languages, with the time their content last changed.
import { catalog } from "../../../../lib/catalog-server";
import { siteUrl } from "../../../../lib/seo";
import {
  localizedEntries,
  PRODUCTS_PER_SITEMAP,
  sitemapXml,
} from "../../../../lib/sitemap";
import { logError } from "../../../../lib/log";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ page: string }> },
) {
  const raw = (await params).page;
  if (!/^\d{1,5}$/.test(raw)) return new Response("Not found", { status: 404 });
  const page = Number(raw);
  try {
    const products = await catalog().listProductSkus(
      page * PRODUCTS_PER_SITEMAP,
      PRODUCTS_PER_SITEMAP,
    );
    // The first file always exists (an empty catalog still has one).
    if (!products.length && page > 0)
      return new Response("Not found", { status: 404 });
    const base = siteUrl();
    const xml = sitemapXml(
      products.flatMap((p) =>
        localizedEntries(
          base,
          `/catalog/${encodeURIComponent(p.sku)}`,
          p.updatedAt,
        ),
      ),
    );
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    void logError("Product sitemap failed", error);
    return new Response("Service unavailable", { status: 503 });
  }
}
