import assert from "node:assert/strict";
import { test } from "node:test";
import { demoCategories, demoProducts } from "./catalog-demo-data";
import { createStaticCatalog } from "./catalog-static";
import { createCatalogSearch, matchCategories } from "./search";

const catalog = createStaticCatalog(
  demoProducts,
  demoCategories.map((c) => c.id),
);

test("categories match by every word, in Cyrillic or Latin", async () => {
  const taxonomy = await catalog.taxonomy();
  assert.deepEqual(
    matchCategories(taxonomy, "филтри", 4).map((c) => [
      c.category,
      c.subcategory,
    ]),
    [["parts-consumables", "filters"]],
  );
  assert.deepEqual(
    matchCategories(taxonomy, "filtri", 4).map((c) => c.subcategory),
    ["filters"],
  );
  assert.equal(
    matchCategories(taxonomy, "части консумативи", 4)[0].category,
    "parts-consumables",
  );
  assert.deepEqual(matchCategories(taxonomy, "  ", 4), []);
  assert.ok(matchCategories(taxonomy, "а", 1).length <= 1);
});

test("suggestions need two characters and stay within the limit", async () => {
  const search = createCatalogSearch(catalog);
  assert.deepEqual(await search.suggest("ф"), { products: [], categories: [] });
  const result = await search.suggest("филтър");
  assert.deepEqual(
    result.products.map((p) => p.sku),
    ["DEMO-003"],
  );
  const capped = await search.suggest("demo", 3);
  assert.equal(capped.products.length, 3);
  assert.ok((await search.suggest("demo", 100)).products.length <= 8);
});
