// Sitemaps (#41): every public URL in both languages, each listing its
// alternates (hreflang). Products are split into files of
// PRODUCTS_PER_SITEMAP products (two URLs each), well under the 50,000-URL
// limit of a sitemap file.
import { localizedPath } from "./seo";

export const PRODUCTS_PER_SITEMAP = 10_000;

/** Pages crawlers must not visit once indexing is on (robots.txt). */
export const PRIVATE_PATHS = [
  "/account",
  "/admin",
  "/api/",
  "/cart",
  "/checkout",
  "/favorites",
  "/for-you",
  "/garage",
  "/inventory-demo",
  "/orders",
];

export type SitemapEntry = {
  url: string;
  lastModified?: Date;
  alternates: { languages: { bg: string; en: string; "x-default": string } };
};

/** Both language versions of a page, each with the same alternates. */
export function localizedEntries(
  base: URL,
  path: string,
  lastModified?: Date | null,
): SitemapEntry[] {
  const absolute = (p: string) => new URL(p, base).toString();
  const languages = {
    bg: absolute(localizedPath(path, "bg")),
    en: absolute(localizedPath(path, "en")),
    "x-default": absolute(localizedPath(path, "bg")),
  };
  return [languages.bg, languages.en].map((url) => ({
    url,
    ...(lastModified && { lastModified }),
    alternates: { languages },
  }));
}

export const productSitemapPath = (index: number) =>
  `/sitemaps/products/${index}`;

/** Sitemap file URLs for robots.txt: the main one and the product files. */
export function sitemapUrls(base: URL, productCount: number): string[] {
  const files = Math.max(1, Math.ceil(productCount / PRODUCTS_PER_SITEMAP));
  return [
    new URL("/sitemap.xml", base).toString(),
    ...Array.from({ length: files }, (_, i) =>
      new URL(productSitemapPath(i), base).toString(),
    ),
  ];
}

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** A urlset document with xhtml:link alternates. */
export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const links = Object.entries(entry.alternates.languages)
      .map(
        ([lang, href]) =>
          `<xhtml:link rel="alternate" hreflang="${lang}" href="${escape(href)}"/>`,
      )
      .join("");
    const lastmod = entry.lastModified
      ? `<lastmod>${entry.lastModified.toISOString()}</lastmod>`
      : "";
    return `<url><loc>${escape(entry.url)}</loc>${lastmod}${links}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join("\n")}
</urlset>
`;
}
