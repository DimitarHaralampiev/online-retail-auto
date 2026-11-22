import assert from "node:assert/strict";
import { test } from "node:test";
import {
  localizedEntries,
  PRODUCTS_PER_SITEMAP,
  sitemapUrls,
  sitemapXml,
} from "./sitemap";

const base = new URL("https://shop.example");

test("each page is listed in both languages with the same alternates", () => {
  const entries = localizedEntries(base, "/catalog?category=car-care");
  assert.deepEqual(
    entries.map((e) => e.url),
    [
      "https://shop.example/catalog?category=car-care",
      "https://shop.example/catalog?category=car-care&lang=en",
    ],
  );
  assert.deepEqual(entries[1].alternates.languages, {
    bg: "https://shop.example/catalog?category=car-care",
    en: "https://shop.example/catalog?category=car-care&lang=en",
    "x-default": "https://shop.example/catalog?category=car-care",
  });
});

test("product sitemap files cover every product", () => {
  assert.equal(sitemapUrls(base, 0).length, 2);
  assert.equal(sitemapUrls(base, PRODUCTS_PER_SITEMAP).length, 2);
  assert.deepEqual(sitemapUrls(base, PRODUCTS_PER_SITEMAP + 1), [
    "https://shop.example/sitemap.xml",
    "https://shop.example/sitemaps/products/0",
    "https://shop.example/sitemaps/products/1",
  ]);
});

test("XML escapes URLs and carries lastmod and hreflang links", () => {
  const xml = sitemapXml(
    localizedEntries(base, "/catalog/A&B", new Date("2026-11-20T10:00:00Z")),
  );
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/shop.example\/catalog\/A&amp;B<\/loc>/);
  assert.match(xml, /<lastmod>2026-11-20T10:00:00.000Z<\/lastmod>/);
  assert.match(
    xml,
    /<xhtml:link rel="alternate" hreflang="en" href="https:\/\/shop.example\/catalog\/A&amp;B\?lang=en"\/>/,
  );
  assert.equal(xml.match(/<url>/g)?.length, 2);
});
