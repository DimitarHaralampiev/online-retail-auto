import assert from "node:assert/strict";
import { test } from "node:test";
import type { Product } from "./catalog";
import {
  breadcrumbJsonLd,
  jsonLdScript,
  productJsonLd,
  websiteJsonLd,
} from "./structured-data";

const base = new URL("https://shop.example");
const product: Product = {
  sku: "BRK-1",
  name: "Спирачни накладки",
  category: { id: "parts", name: "Части" },
  subcategory: { id: "brakes", name: "Спирачки" },
  description: "Предни накладки",
  image: "/images/brakes.png",
  priceCents: 4590,
  salePriceCents: 3990,
  stock: { onHand: 3, reserved: 1 },
};

test("Product JSON-LD carries the paid price, currency and stock only", () => {
  const data = productJsonLd(product, base);
  assert.deepEqual(data, {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Спирачни накладки",
    sku: "BRK-1",
    description: "Предни накладки",
    image: ["https://shop.example/images/brakes.png"],
    category: "Части > Спирачки",
    offers: {
      "@type": "Offer",
      url: "https://shop.example/catalog/BRK-1",
      priceCurrency: "EUR",
      price: "39.90",
      availability: "https://schema.org/InStock",
    },
  });
  // Nothing the catalog does not know.
  for (const key of ["aggregateRating", "review", "brand", "itemCondition"])
    assert.ok(!(key in data), key);
  const soldOut = productJsonLd(
    {
      ...product,
      salePriceCents: undefined,
      stock: { onHand: 2, reserved: 2 },
    },
    base,
  ) as { offers: { price: string; availability: string } };
  assert.equal(soldOut.offers.price, "45.90");
  assert.equal(soldOut.offers.availability, "https://schema.org/OutOfStock");
});

test("a rating appears only from published reviews", () => {
  assert.ok(
    !(
      "aggregateRating" in
      productJsonLd(product, base, { count: 0, average: null })
    ),
  );
  assert.deepEqual(
    productJsonLd(product, base, { count: 3, average: 4.33 }).aggregateRating,
    {
      "@type": "AggregateRating",
      ratingValue: "4.3",
      reviewCount: 3,
      bestRating: 5,
      worstRating: 1,
    },
  );
});

test("breadcrumbs are numbered with absolute URLs", () => {
  assert.deepEqual(
    breadcrumbJsonLd(
      [
        { name: "Начало", path: "/" },
        { name: "Каталог", path: "/catalog" },
      ],
      base,
    ).itemListElement,
    [
      {
        "@type": "ListItem",
        position: 1,
        name: "Начало",
        item: "https://shop.example/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Каталог",
        item: "https://shop.example/catalog",
      },
    ],
  );
});

test("the site search template points at the catalog", () => {
  const site = websiteJsonLd(base) as {
    potentialAction: { target: { urlTemplate: string } };
  };
  assert.equal(
    site.potentialAction.target.urlTemplate,
    "https://shop.example/catalog?q={search_term_string}",
  );
});

test("script content cannot close the tag", () => {
  const script = jsonLdScript({ name: "</script><script>alert(1)</script>" });
  assert.ok(!script.includes("<"));
  assert.deepEqual(JSON.parse(script), {
    name: "</script><script>alert(1)</script>",
  });
});
