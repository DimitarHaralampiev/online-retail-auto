// /robots.txt (#41): crawling is closed until the shop is live
// (SITE_INDEXABLE=1, see src/lib/seo.ts); then public pages are open,
// private ones closed, and the sitemaps listed.
import type { MetadataRoute } from "next";
import { catalog } from "../lib/catalog-server";
import { indexable, siteUrl } from "../lib/seo";
import { PRIVATE_PATHS, sitemapUrls } from "../lib/sitemap";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!indexable()) return { rules: { userAgent: "*", disallow: "/" } };
  const base = siteUrl();
  const count = await catalog()
    .countProducts()
    .catch(() => 0);
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
    sitemap: sitemapUrls(base, count),
  };
}
