// schema.org structured data (JSON-LD) for search engines (#42). Only facts
// the catalog holds: name, SKU, description, image, the price the shopper
// pays, currency and stock, and a rating only from published verified-buyer
// reviews (#49). No invented ratings, condition or other claims.
import type { Product } from "./catalog";
import { availableStock } from "./inventory";
import { sellingPrice } from "./pricing";
import { SITE_NAME } from "./seo";

type Json = Record<string, unknown>;

const euros = (cents: number) => (cents / 100).toFixed(2);

export function productJsonLd(
  product: Product,
  base: URL,
  rating?: { count: number; average: number | null },
): Json {
  const url = new URL(`/catalog/${encodeURIComponent(product.sku)}`, base);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.sku,
    ...(product.description && { description: product.description }),
    image: [new URL(product.image, base).toString()],
    category: product.subcategory
      ? `${product.category.name} > ${product.subcategory.name}`
      : product.category.name,
    ...(rating &&
      rating.count > 0 &&
      rating.average !== null && {
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: rating.average.toFixed(1),
          reviewCount: rating.count,
          bestRating: 5,
          worstRating: 1,
        },
      }),
    offers: {
      "@type": "Offer",
      url: url.toString(),
      priceCurrency: "EUR",
      price: euros(sellingPrice(product)),
      availability:
        availableStock(product.stock) > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
    },
  };
}

export type Crumb = { name: string; path: string };

export function breadcrumbJsonLd(crumbs: readonly Crumb[], base: URL): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: new URL(crumb.path, base).toString(),
    })),
  };
}

/** The site and its search (sitelinks search box) for the home page. */
export function websiteJsonLd(base: URL): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: new URL("/", base).toString(),
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${new URL("/catalog", base)}?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * JSON for a <script type="application/ld+json">: "<" is escaped so text
 * from the catalog can never close the script element.
 */
export const jsonLdScript = (data: Json | Json[]) =>
  JSON.stringify(data).replace(/</g, "\\u003c");
