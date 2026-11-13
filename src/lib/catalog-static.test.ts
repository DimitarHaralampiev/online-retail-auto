import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTaxonomy,
  DEFAULT_PAGE_SIZE,
  MAX_BROWSE_TEXT,
  MAX_COMPATIBLE_SKUS,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  normalizeBrowseQuery,
  type BrowseSort,
  pageWindow,
  productLookup,
  type Product,
} from "./catalog";
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

test("page window clamps page and size", () => {
  assert.deepEqual(pageWindow({}), { page: 1, pageSize: DEFAULT_PAGE_SIZE });
  assert.deepEqual(pageWindow({ page: 0, pageSize: 0 }), {
    page: 1,
    pageSize: 1,
  });
  assert.deepEqual(pageWindow({ page: 2.7, pageSize: 1_000 }), {
    page: 2,
    pageSize: MAX_PAGE_SIZE,
  });
});

test("static browse filters, sorts and paginates", async () => {
  const store = createStaticCatalog(products, ["Части", "Аксесоари"]);
  const page = await store.browse({ category: "Части", pageSize: 2, page: 2 });
  assert.deepEqual(
    page.items.map((p) => p.sku),
    ["D"],
  );
  assert.equal(page.total, 3);
  assert.equal(page.pageCount, 2);
  const filters = await store.browse({ subcategory: "filters" });
  assert.deepEqual(
    filters.items.map((p) => p.sku),
    ["A", "D"],
  );
  assert.equal((await store.browse({ text: "product b" })).total, 1);
});

test("browse input is normalised to safe values", () => {
  const q = normalizeBrowseQuery({
    page: Number.NaN,
    pageSize: Number.POSITIVE_INFINITY,
    minPriceCents: 1500.2,
    maxPriceCents: 3e9,
    text: `  ${"x".repeat(150)}  `,
    sort: "bogus" as BrowseSort,
    locale: "de" as "bg",
    category: "",
  });
  assert.equal(q.page, 1);
  assert.equal(q.pageSize, DEFAULT_PAGE_SIZE);
  assert.equal(q.minPriceCents, 1501);
  assert.equal(q.maxPriceCents, 2_147_483_647);
  assert.equal(q.text?.length, MAX_BROWSE_TEXT);
  assert.equal(q.sort, "featured");
  assert.equal(q.locale, "bg");
  assert.equal(q.category, undefined);
  assert.equal(normalizeBrowseQuery({ page: 1e20 }).page, MAX_PAGE);
  assert.equal(normalizeBrowseQuery({ maxPriceCents: -50 }).maxPriceCents, -1);
  assert.equal(
    normalizeBrowseQuery({ minPriceCents: Number.NaN }).minPriceCents,
    undefined,
  );
  assert.equal(normalizeBrowseQuery({ text: "   " }).text, undefined);
  // A cut that ends on a space is trimmed again.
  assert.equal(
    normalizeBrowseQuery({ text: `${"x".repeat(99)} tail` }).text,
    "x".repeat(99),
  );
  assert.throws(
    () =>
      normalizeBrowseQuery({
        compatibleSkus: Array.from({ length: MAX_COMPATIBLE_SKUS + 1 }, String),
      }),
    /at most/,
  );
});
