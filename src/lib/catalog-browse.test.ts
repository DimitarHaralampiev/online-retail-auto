import test from "node:test";
import assert from "node:assert/strict";
import {
  browseProducts,
  priceFilterCents,
  type BrowseFilters,
} from "./catalog-browse";
import { demoProducts } from "./catalog";
import { translate } from "./i18n/translate";
const defaults: BrowseFilters = {
  category: "",
  subcategory: "",
  query: "",
  minPrice: "",
  maxPrice: "",
  available: false,
  promotions: false,
  sort: "featured",
};
test("price filtering uses selling prices after discounts and accepts comma decimals", () => {
  assert.deepEqual(
    browseProducts(demoProducts, {
      ...defaults,
      minPrice: "6,00",
      maxPrice: "7.00",
    }).products.map((p) => p.sku),
    ["DEMO-005"],
  );
  assert.equal(priceFilterCents("12,34"), 1234);
  for (const value of ["-1", "1.234", "1e5", "abc"])
    assert.equal(priceFilterCents(value), undefined);
  assert.equal(
    browseProducts(demoProducts, {
      ...defaults,
      minPrice: "20",
      maxPrice: "10",
    }).invalidPrice,
    true,
  );
});
test("combined filters respect free stock and do not invent compatibility", () => {
  assert.equal(
    browseProducts(demoProducts, { ...defaults, available: true }).products
      .length,
    4,
  );
  assert.equal(
    browseProducts(demoProducts, { ...defaults, promotions: true }).products
      .length,
    3,
  );
  assert.equal(
    browseProducts(demoProducts, { ...defaults, compatibleSkus: [] }).products
      .length,
    0,
  );
  assert.deepEqual(
    browseProducts(demoProducts, {
      ...defaults,
      category: "Автоаксесоари",
      subcategory: "phone-holders",
    }).products.map((p) => p.sku),
    ["DEMO-002"],
  );
});
test("sorting is stable, preserves source data and English search finds translated products", () => {
  const before = demoProducts.map((p) => p.sku);
  assert.equal(
    browseProducts(demoProducts, { ...defaults, sort: "price-asc" }).products[0]
      .sku,
    "DEMO-006",
  );
  assert.equal(
    browseProducts(demoProducts, { ...defaults, sort: "price-desc" })
      .products[0].sku,
    "DEMO-004",
  );
  assert.deepEqual(
    demoProducts.map((p) => p.sku),
    before,
  );
  assert.deepEqual(
    browseProducts(demoProducts, { ...defaults, query: "phone" }, (s) =>
      translate(s, "en"),
    ).products.map((p) => p.sku),
    ["DEMO-002"],
  );
});
