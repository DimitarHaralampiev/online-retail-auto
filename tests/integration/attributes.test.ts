import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attributeInputSchema,
  attributeKeySchema,
  createAttribute,
  listAttributes,
  productSpecs,
  updateAttribute,
} from "../../src/lib/admin-attributes";
import {
  AdminProductError,
  createProduct,
  getAdminProduct,
  productInputSchema,
  updateProduct,
} from "../../src/lib/admin-products";
import { attributeValueKey } from "../../src/lib/attributes";
import { createPostgresCatalog } from "../../src/lib/catalog-postgres";
import { seedDemoCatalog } from "../../src/lib/catalog-seed";
import { importProducts } from "../../src/lib/product-import";
import { insertCustomer, setupTestDatabase } from "./database";

let admin = "";
// Fictional attributes on the demo products.
const VALUES: [sku: string, key: string, value: string][] = [
  ["DEMO-001", "size", "450"],
  ["DEMO-002", "size", "90"],
  ["DEMO-003", "size", "450"],
  ["DEMO-001", "colour", "Черен"],
  ["DEMO-002", "colour", "черен"],
  ["DEMO-003", "colour", "Син"],
  ["DEMO-004", "colour", "Черен"],
  ["DEMO-003", "internal", "x"],
];
const db = setupTestDatabase({
  async prepare({ pool }) {
    const client = await pool.connect();
    try {
      await seedDemoCatalog(client);
    } finally {
      client.release();
    }
    admin = await insertCustomer(pool, { isAdmin: true });
    const define = (key: string, input: object) =>
      createAttribute(pool, admin, key, attributeInputSchema.parse(input));
    await define("size", {
      name: { bg: "Размер", en: "Size" },
      unit: "mm",
      sortOrder: 2,
    });
    await define("colour", { name: { bg: "Цвят" }, sortOrder: 1 });
    await define("internal", {
      name: { bg: "Вътрешна" },
      filterable: false,
    });
    for (const [sku, key, value] of VALUES)
      await pool.query(
        "INSERT INTO product_attributes(sku, key, value) VALUES ($1,$2,$3)",
        [sku, key, value],
      );
    await pool.query(
      `UPDATE warehouse_products SET brand = CASE WHEN sku IN ('DEMO-001','DEMO-003')
         THEN 'Alpha' ELSE 'Beta' END`,
    );
  },
});

const store = (locale: "bg" | "en" = "bg") =>
  createPostgresCatalog(() => db().pool, locale);
const skus = async (query: Parameters<ReturnType<typeof store>["browse"]>[0]) =>
  (await store().browse({ ...query, pageSize: 96 })).items
    .map((p) => p.sku)
    .sort();
const counts = async (
  query: Parameters<ReturnType<typeof store>["facets"]>[0],
) =>
  Object.fromEntries(
    (await store().facets(query)).attributes.map((a) => [
      a.key,
      a.values.map((v) => `${v.key}=${v.count}`),
    ]),
  );

const refused = (promise: Promise<unknown>, status: number, message: RegExp) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AdminProductError, String(error));
    assert.equal(error.status, status);
    assert.match(error.message, message);
    return true;
  });

test("attributeValueKey() matches the SQL attribute_value_key() exactly", async () => {
  const samples = [
    "5W-30",
    "  Черен  мат ",
    "1,5",
    "1,2,3",
    "-20",
    "ÄÖ",
    "H4, H7",
    "1.5",
    "Ж\tЩ",
  ];
  const result = await db().pool.query<{ key: string }>(
    "SELECT attribute_value_key(v) AS key FROM unnest($1::text[]) WITH ORDINALITY AS t(v, i) ORDER BY i",
    [samples],
  );
  assert.deepEqual(
    result.rows.map((r) => r.key),
    samples.map(attributeValueKey),
  );
});

test("facets group spellings, sort values naturally and skip internal ones", async () => {
  const { attributes } = await store().facets({});
  assert.deepEqual(attributes, [
    {
      key: "colour",
      name: "Цвят",
      unit: "",
      values: [
        { key: "син", value: "Син", count: 1 },
        { key: "черен", value: "Черен", count: 3 },
      ],
    },
    {
      key: "size",
      name: "Размер",
      unit: "mm",
      values: [
        { key: "90", value: "90", count: 1 },
        { key: "450", value: "450", count: 2 },
      ],
    },
  ]);
  const english = (await store("en").facets({})).attributes;
  // Translated name, or the Bulgarian one when there is none.
  assert.deepEqual(
    english.map((a) => a.name),
    ["Цвят", "Size"],
  );
});

test("values of one attribute combine as OR, attributes as AND", async () => {
  assert.deepEqual(await skus({ attributes: { colour: ["черен"] } }), [
    "DEMO-001",
    "DEMO-002",
    "DEMO-004",
  ]);
  assert.deepEqual(await skus({ attributes: { colour: ["черен", "син"] } }), [
    "DEMO-001",
    "DEMO-002",
    "DEMO-003",
    "DEMO-004",
  ]);
  assert.deepEqual(
    await skus({ attributes: { colour: ["черен"], size: ["450"] } }),
    ["DEMO-001"],
  );
  assert.deepEqual(await skus({ attributes: { colour: ["лилав"] } }), []);
});

test("each facet counts under every other filter, not its own", async () => {
  // Own choice keeps the other values' counts…
  assert.deepEqual(await counts({ attributes: { colour: ["черен"] } }), {
    colour: ["син=1", "черен=3"],
    size: ["90=1", "450=1"],
  });
  // …and narrows the other attributes, both ways.
  assert.deepEqual(
    await counts({ attributes: { colour: ["черен"], size: ["450"] } }),
    { colour: ["син=1", "черен=1"], size: ["90=1", "450=1"] },
  );
  // Brands narrow attributes, and attributes narrow brands.
  assert.deepEqual(await counts({ brands: ["alpha"] }), {
    colour: ["син=1", "черен=1"],
    size: ["450=2"],
  });
  assert.deepEqual(
    (await store().facets({ attributes: { size: ["450"] } })).brands,
    [{ key: "alpha", name: "Alpha", count: 2 }],
  );
  // Every count equals the results of actually choosing that value.
  for (const query of [{}, { brands: ["beta"] }, { promotions: true }])
    for (const facet of (await store().facets(query)).attributes)
      for (const value of facet.values)
        assert.equal(
          (await skus({ ...query, attributes: { [facet.key]: [value.key] } }))
            .length,
          value.count,
          `${facet.key}=${value.key}`,
        );
});

test("a chosen attribute stays listed without matches; unknown ones are ignored", async () => {
  assert.deepEqual(
    await counts({ attributes: { colour: ["лилав"] }, text: "няма такъв" }),
    { colour: [] },
  );
  const all = await skus({});
  assert.deepEqual(await skus({ attributes: { gone: ["1"] } }), all);
  // Not filterable: neither a facet nor a filter.
  assert.deepEqual(await skus({ attributes: { internal: ["x"] } }), all);
  assert.equal(
    (await counts({ attributes: { internal: ["x"] } })).internal,
    undefined,
  );
});

test("hidden products do not count", async () => {
  await db().pool.query(
    "UPDATE warehouse_products SET status='draft' WHERE sku='DEMO-004'",
  );
  try {
    assert.deepEqual((await counts({})).colour, ["син=1", "черен=2"]);
  } finally {
    await db().pool.query(
      "UPDATE warehouse_products SET status='published' WHERE sku='DEMO-004'",
    );
  }
});

test("paging, totals and every sort work with attribute filters", async () => {
  for (const sort of ["featured", "price-asc", "price-desc", "name"] as const) {
    const page = await store().browse({
      attributes: { colour: ["черен"] },
      sort,
      pageSize: 2,
      page: 2,
    });
    assert.equal(page.total, 3);
    assert.equal(page.items.length, 1);
  }
  const past = await store().browse({
    attributes: { colour: ["черен"] },
    page: 9,
  });
  assert.equal(past.total, 3);
  const search = await store().browse({
    attributes: { size: ["450"] },
    search: "филтър",
  });
  assert.deepEqual(
    search.items.map((p) => p.sku),
    ["DEMO-003"],
  );
});

test("definitions: unique keys, stale edits refused, changes audited", async () => {
  const { pool } = db();
  const input = attributeInputSchema.parse({ name: { bg: "Цокъл" } });
  const created = await createAttribute(pool, admin, "socket", input);
  assert.equal(created.version, 1);
  await refused(createAttribute(pool, admin, "socket", input), 409, /вече има/);
  const renamed = await updateAttribute(pool, admin, "socket", 1, {
    ...input,
    name: { bg: "Цокъл на крушка", en: "Bulb socket" },
  });
  assert.equal(renamed.version, 2);
  await refused(
    updateAttribute(pool, admin, "socket", 1, input),
    409,
    /междувременно/,
  );
  await refused(
    updateAttribute(pool, admin, "missing", 1, input),
    404,
    /не е намерена/,
  );
  const audit = await pool.query(
    "SELECT action FROM admin_audit_log WHERE entity_type='attribute' AND entity_id='socket' ORDER BY created_at",
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ["attribute.create", "attribute.update"],
  );
  assert.equal(
    (await listAttributes(pool)).find((a) => a.key === "size")!.products,
    3,
  );
  for (const key of [
    "",
    "Цвят",
    "a b",
    "A",
    "-a",
    "constructor",
    "x".repeat(41),
  ])
    assert.equal(attributeKeySchema.safeParse(key).success, false, key);
  for (const name of ["", "A", "x".repeat(61), "a\u0000b"])
    assert.equal(
      attributeInputSchema.safeParse({ name: { bg: name } }).success,
      false,
    );
});

test("product edits set, change, clear and keep attribute values", async () => {
  const { pool } = db();
  const base = { name: { bg: "Крушка" } };
  await createProduct(
    pool,
    admin,
    "ATTR-1",
    productInputSchema.parse({
      ...base,
      attributes: { size: "  12,5 ", colour: "Син   мат", internal: " " },
    }),
  );
  let product = (await getAdminProduct(pool, "ATTR-1"))!;
  assert.deepEqual(product.attributes, { colour: "Син мат", size: "12,5" });
  // Left out: untouched, and not a change by itself.
  product = await updateProduct(
    pool,
    admin,
    "ATTR-1",
    product.version,
    productInputSchema.parse(base),
  );
  assert.equal(product.version, 1);
  product = await updateProduct(
    pool,
    admin,
    "ATTR-1",
    product.version,
    productInputSchema.parse({ ...base, attributes: { size: "13" } }),
  );
  assert.equal(product.version, 2);
  assert.deepEqual(product.attributes, { size: "13" });
  const audit = await pool.query(
    "SELECT details FROM admin_audit_log WHERE entity_id='ATTR-1' AND action='product.update'",
  );
  assert.deepEqual(audit.rows[0].details.changes.attributes, {
    from: { colour: "Син мат", size: "12,5" },
    to: { size: "13" },
  });
  // The same values again change nothing.
  product = await updateProduct(
    pool,
    admin,
    "ATTR-1",
    product.version,
    productInputSchema.parse({ ...base, attributes: { size: "13 " } }),
  );
  assert.equal(product.version, 2);
  await refused(
    updateProduct(
      pool,
      admin,
      "ATTR-1",
      product.version,
      productInputSchema.parse({ ...base, attributes: { unknown: "1" } }),
    ),
    400,
    /Непозната характеристика: unknown/,
  );
  assert.deepEqual((await getAdminProduct(pool, "ATTR-1"))!.attributes, {
    size: "13",
  });
  for (const attributes of [
    { size: "x".repeat(101) },
    { size: "a\u0000b" },
    { "Bad Key": "1" },
    { size: 5 },
  ])
    assert.equal(
      productInputSchema.safeParse({ ...base, attributes }).success,
      false,
    );
});

test("the product page lists values with units in display order", async () => {
  const { pool } = db();
  assert.deepEqual(await productSpecs(pool, "DEMO-003", "bg"), [
    { key: "internal", name: "Вътрешна", text: "x" },
    { key: "colour", name: "Цвят", text: "Син" },
    { key: "size", name: "Размер", text: "450 mm" },
  ]);
  assert.equal(
    (await productSpecs(pool, "DEMO-003", "en")).at(-1)!.name,
    "Size",
  );
  assert.deepEqual(await productSpecs(pool, "DEMO-006", "bg"), []);
});

test("CSV import fills attr: columns; empty cells keep, unknown keys refuse the file", async () => {
  const { pool } = db();
  const run = (csv: string, apply = true) =>
    importProducts(pool, admin, csv, { apply });
  const created = await run(
    "sku;name_bg;attr:size;attr:colour\nCSV-1;Лампа;10;Бял\nCSV-2;Лампа две;;\n",
  );
  assert.equal(created.applied, true, JSON.stringify(created));
  assert.deepEqual((await getAdminProduct(pool, "CSV-1"))!.attributes, {
    colour: "Бял",
    size: "10",
  });
  assert.deepEqual((await getAdminProduct(pool, "CSV-2"))!.attributes, {});
  const changed = await run("sku;attr:size;attr:colour\nCSV-1;12;\n");
  assert.equal(changed.rows[0].action, "update");
  assert.deepEqual((await getAdminProduct(pool, "CSV-1"))!.attributes, {
    colour: "Бял",
    size: "12",
  });
  const same = await run("sku;attr:size\nCSV-1;12\n");
  assert.equal(same.rows[0].action, "unchanged");
  // Files without attr: columns leave the values alone.
  await run("sku;name_bg\nCSV-1;Лампа ново\n");
  assert.deepEqual((await getAdminProduct(pool, "CSV-1"))!.attributes, {
    colour: "Бял",
    size: "12",
  });
  const unknown = await run("sku;attr:nope\nCSV-1;1\n");
  assert.equal(unknown.applied, false);
  assert.match(unknown.error ?? "", /attr:nope/);
  const long = await run(`sku;attr:size\nCSV-1;${"9".repeat(101)}\n`);
  assert.equal(long.applied, false);
  assert.match(long.rows[0].errors.join(" "), /до 100 знака/);
  // A check changes nothing.
  await run("sku;attr:size\nCSV-1;99\n", false);
  assert.equal((await getAdminProduct(pool, "CSV-1"))!.attributes.size, "12");
});
