import assert from "node:assert/strict";
import { test } from "node:test";
import robots from "../../src/app/robots";
import sitemap from "../../src/app/sitemap";
import { GET as productSitemap } from "../../src/app/sitemaps/products/[page]/route";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { setupTestDatabase } from "./database";

Object.assign(process.env, {
  CATALOG_SOURCE: "postgres",
  APP_URL: "https://shop.example",
});
const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    await pool.query(
      "UPDATE warehouse_products SET status='draft' WHERE sku='DEMO-002'",
    );
  },
});

test("the repository counts and pages visible products only", async () => {
  const store = createPostgresCatalog(() => db().pool);
  assert.equal(await store.countProducts(), 5);
  const page = await store.listProductSkus(1, 2);
  assert.deepEqual(
    page.map((p) => p.sku),
    ["DEMO-003", "DEMO-004"],
  );
  assert.ok(page[0].updatedAt instanceof Date);
  assert.deepEqual(await store.listProductSkus(10, 5), []);
});

test("product sitemaps list both languages; drafts and bad pages are left out", async () => {
  const response = await productSitemap(
    new Request("https://shop.example/sitemaps/products/0"),
    {
      params: Promise.resolve({ page: "0" }),
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type")!, /application\/xml/);
  const xml = await response.text();
  assert.equal(xml.match(/<url>/g)?.length, 10);
  assert.match(
    xml,
    /<loc>https:\/\/shop.example\/catalog\/DEMO-001\?lang=en<\/loc>/,
  );
  assert.doesNotMatch(xml, /DEMO-002/);
  for (const page of ["1", "x", "-1", "123456"])
    assert.equal(
      (
        await productSitemap(new Request("https://shop.example/"), {
          params: Promise.resolve({ page }),
        })
      ).status,
      404,
      page,
    );
});

test("the main sitemap covers pages and categories in both languages", async () => {
  const entries = await sitemap();
  const urls = entries.map((e) => e.url);
  assert.ok(urls.includes("https://shop.example/"));
  assert.ok(urls.includes("https://shop.example/?lang=en"));
  assert.ok(
    urls.includes(
      "https://shop.example/catalog?category=parts-consumables&subcategory=filters",
    ),
  );
  // No car pages without vehicle reference data.
  assert.ok(!urls.some((u) => u.includes("/cars")));
});

test("robots closes the site until it is indexable", async () => {
  delete process.env.SITE_INDEXABLE;
  assert.deepEqual(await robots(), {
    rules: { userAgent: "*", disallow: "/" },
  });
  process.env.SITE_INDEXABLE = "1";
  try {
    const open = await robots();
    assert.deepEqual(open.sitemap, [
      "https://shop.example/sitemap.xml",
      "https://shop.example/sitemaps/products/0",
    ]);
    const rules = open.rules as { disallow: string[] };
    assert.ok(rules.disallow.includes("/checkout"));
    assert.ok(rules.disallow.includes("/admin"));
  } finally {
    delete process.env.SITE_INDEXABLE;
  }
});
