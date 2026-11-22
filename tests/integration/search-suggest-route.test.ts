import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../../src/app/api/search/suggest/route";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { setupTestDatabase } from "./database";

process.env.CATALOG_SOURCE = "postgres";
setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
  },
});

const get = (query: string, ip = "203.0.113.1", cookie?: string) =>
  GET(
    new Request(`http://localhost/api/search/suggest${query}`, {
      headers: { "x-forwarded-for": ip, ...(cookie && { cookie }) },
    }),
  );

test("short queries return nothing without touching the catalog", async () => {
  const response = await get("?q=ф", "198.51.100.1");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { products: [], categories: [] });
});

test("suggestions carry links, localised names and live prices", async () => {
  const bg = await (
    await get("?q=%D1%84%D0%B8%D0%BB%D1%82%D1%80", "198.51.100.2")
  ).json();
  assert.equal(bg.products[0].sku, "DEMO-003");
  assert.equal(bg.products[0].href, "/catalog/DEMO-003");
  assert.equal(bg.products[0].name, "Въздушен филтър");
  assert.ok(Number.isInteger(bg.products[0].priceCents));
  const en = await (await get("?q=filters&locale=en", "198.51.100.2")).json();
  assert.deepEqual(en.categories[0], {
    name: "Filters",
    parent: "Parts and consumables",
    href: "/catalog?category=parts-consumables&subcategory=filters",
  });
  // Without ?locale= the language cookie decides.
  const cookie = await (
    await get("?q=filter", "198.51.100.2", "auto_locale=en")
  ).json();
  assert.equal(cookie.products[0].name, "Air filter");
});

test("one client is limited to 30 requests per 10 seconds", async () => {
  const ip = "192.0.2.50";
  for (let i = 0; i < 30; i++)
    assert.equal((await get("?q=x", ip)).status, 200, `request ${i + 1}`);
  const limited = await get("?q=x", ip);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  // Other clients are not affected.
  assert.equal((await get("?q=x", "192.0.2.51")).status, 200);
});
