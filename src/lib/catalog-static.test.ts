import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTaxonomy, productLookup, type Product } from "./catalog";
import { createStaticCatalog } from "./catalog-static";

function product(
  sku: string,
  category: string,
  subcategory: Product["subcategory"],
): Product {
  return {
    sku,
    name: `Product ${sku}`,
    category,
    subcategory,
    description: "",
    image: "/images/organizer.png",
    demoPriceCents: 1000,
    stock: { onHand: 1, reserved: 0 },
  };
}

const filters = { id: "filters", name: "Филтри" };
const wipers = { id: "wipers", name: "Чистачки" };
const products = [
  product("A", "Части", filters),
  product("B", "Аксесоари", null),
  product("C", "Части", wipers),
  product("D", "Части", filters),
];

test("taxonomy keeps category order, counts products and omits empty categories", () => {
  assert.deepEqual(buildTaxonomy(products, ["Аксесоари", "Празна", "Части"]), [
    { name: "Аксесоари", productCount: 1, subcategories: [] },
    {
      name: "Части",
      productCount: 3,
      subcategories: [
        { ...filters, productCount: 2 },
        { ...wipers, productCount: 1 },
      ],
    },
  ]);
});

test("categories missing from the configured order are appended, not dropped", () => {
  assert.deepEqual(
    buildTaxonomy(products, ["Части"]).map((c) => [c.name, c.productCount]),
    [
      ["Части", 3],
      ["Аксесоари", 1],
    ],
  );
});

test("static catalog finds products by SKU in request order", async () => {
  const store = createStaticCatalog(products, ["Части", "Аксесоари"]);
  assert.equal((await store.listProducts()).length, 4);
  assert.equal((await store.getProduct("C"))?.sku, "C");
  assert.equal(await store.getProduct("missing"), null);
  assert.deepEqual(
    (await store.getProducts(["D", "missing", "A"])).map((p) => p.sku),
    ["D", "A"],
  );
  assert.equal((await store.taxonomy())[0].name, "Части");
});

test("listProducts returns a new array, so callers cannot add or remove products", async () => {
  const store = createStaticCatalog(products, ["Части"]);
  (await store.listProducts()).pop();
  assert.equal((await store.listProducts()).length, 4);
});

test("product lookup resolves known SKUs only", () => {
  const lookup = productLookup(products);
  assert.equal(lookup("B")?.category, "Аксесоари");
  assert.equal(lookup("Z"), undefined);
});
