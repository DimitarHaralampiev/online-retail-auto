import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browseQueryFor,
  catalogHref,
  EMPTY_CATALOG_STATE,
  parseCatalogSearch,
  parseCatalogUrl,
  priceRange,
} from "./catalog-url";

test("parses a full catalog URL", () => {
  assert.deepEqual(
    parseCatalogUrl({
      category: "car-care",
      subcategory: "washing",
      q: "  шампоан ",
      min: "5",
      max: "20,50",
      available: "1",
      promotions: "1",
      car: "1",
      sort: "price-desc",
      page: "3",
    }),
    {
      category: "car-care",
      subcategory: "washing",
      q: "шампоан",
      min: "5",
      max: "20,50",
      available: true,
      promotions: true,
      car: true,
      brands: [],
      attributes: {},
      sort: "price-desc",
      page: 3,
    },
  );
});

test("malformed or hostile parameters fall back to defaults", () => {
  assert.deepEqual(parseCatalogUrl({}), EMPTY_CATALOG_STATE);
  const state = parseCatalogUrl({
    q: ["first", "second"],
    sort: "DROP TABLE",
    page: "999999",
    available: "true",
    min: "x".repeat(50),
  });
  assert.equal(state.q, "first");
  assert.equal(state.sort, "featured");
  // Beyond the cap: clamped, then shown as past the end.
  assert.equal(state.page, 1000);
  assert.equal(state.available, false);
  assert.equal(state.min.length, 12);
  for (const page of ["0", "-2", "1.5", "abc", "NaN", "Infinity", ""])
    assert.equal(parseCatalogUrl({ page }).page, 1, page);
  assert.equal(parseCatalogUrl({ q: "x".repeat(500) }).q.length, 100);
});

test("price ranges accept up to two decimals and reject reversed bounds", () => {
  assert.deepEqual(priceRange({ min: "1,5", max: "" }), {
    valid: true,
    minPriceCents: 150,
    maxPriceCents: undefined,
  });
  assert.deepEqual(priceRange({ min: "", max: "" }), {
    valid: true,
    minPriceCents: undefined,
    maxPriceCents: undefined,
  });
  for (const [min, max] of [
    ["abc", ""],
    ["1.234", ""],
    ["20", "10"],
  ])
    assert.equal(priceRange({ min, max }).valid, false, `${min}-${max}`);
});

test("builds the browse query for a locale and rejects invalid prices", () => {
  const state = parseCatalogUrl({
    q: "филтър",
    min: "10",
    sort: "name",
    page: "2",
  });
  assert.deepEqual(browseQueryFor(state, "en", 24), {
    category: undefined,
    subcategory: undefined,
    search: "филтър",
    minPriceCents: 1000,
    maxPriceCents: undefined,
    available: false,
    promotions: false,
    brands: undefined,
    attributes: {},
    sort: "name",
    locale: "en",
    page: 2,
    pageSize: 24,
  });
  assert.equal(
    browseQueryFor(parseCatalogUrl({ min: "9", max: "1" }), "bg"),
    null,
  );
});

test("links keep state canonical and reset paging on filter changes", () => {
  const state = parseCatalogUrl({
    category: "car-care",
    page: "4",
    sort: "name",
  });
  assert.equal(catalogHref(EMPTY_CATALOG_STATE), "/catalog");
  assert.equal(
    catalogHref(state, { page: 5 }),
    "/catalog?category=car-care&sort=name&page=5",
  );
  assert.equal(
    catalogHref(state, { available: true }),
    "/catalog?category=car-care&available=1&sort=name",
  );
  // Round trip.
  const url = new URL(
    catalogHref(state, { q: "a&b=c", promotions: true }),
    "http://x",
  );
  assert.deepEqual(parseCatalogUrl(Object.fromEntries(url.searchParams)), {
    ...state,
    q: "a&b=c",
    promotions: true,
    page: 1,
  });
});

test("page numbers must be plain digits and clamp to the cap", () => {
  for (const page of ["1e2", " 3", "0x10", "3abc", "+2"])
    assert.equal(parseCatalogUrl({ page }).page, 1, page);
  assert.equal(parseCatalogUrl({ page: "1000" }).page, 1000);
  assert.equal(parseCatalogUrl({ page: "1001" }).page, 1000);
  assert.equal(parseCatalogUrl({ page: "0" }).page, 1);
});

test("control characters in text parameters become spaces", () => {
  const state = parseCatalogUrl({ q: "фил\u0000тър", category: "\u0000" });
  assert.equal(state.q, "фил тър");
  assert.equal(state.category, "");
});

test("text parameters are capped per field", () => {
  const long = parseCatalogUrl({
    category: "к".repeat(500),
    subcategory: "s".repeat(500),
    max: "9".repeat(50),
  });
  assert.equal(long.category.length, 120);
  assert.equal(long.subcategory.length, 80);
  assert.equal(long.max.length, 12);
});

test("equal price bounds are valid; a malformed maximum is not", () => {
  assert.deepEqual(priceRange({ min: "10", max: "10" }), {
    valid: true,
    minPriceCents: 1000,
    maxPriceCents: 1000,
  });
  assert.equal(priceRange({ min: "", max: "ten" }).valid, false);
});

test("the browse query carries every filter but never vehicle SKUs", () => {
  const query = browseQueryFor(
    parseCatalogUrl({
      available: "1",
      promotions: "1",
      car: "1",
      subcategory: "x",
    }),
    "bg",
  );
  assert.equal(query?.available, true);
  assert.equal(query?.promotions, true);
  assert.equal(query?.subcategory, "x");
  assert.equal(query && "compatibleSkus" in query, false);
});

test("links carry every filter", () => {
  const all = parseCatalogUrl({
    category: "parts-consumables",
    subcategory: "filters",
    q: "филтър",
    min: "1",
    max: "50",
    available: "1",
    promotions: "1",
    car: "1",
    sort: "name",
    page: "2",
  });
  const href = catalogHref(all, { page: 2 });
  const url = new URL(href, "http://x");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    category: "parts-consumables",
    subcategory: "filters",
    q: "филтър",
    min: "1",
    max: "50",
    available: "1",
    promotions: "1",
    car: "1",
    sort: "name",
    page: "2",
  });
  assert.deepEqual(parseCatalogUrl(Object.fromEntries(url.searchParams)), all);
});

test("brands are repeatable, validated, sorted and round-trip", () => {
  assert.deepEqual(parseCatalogUrl({ brand: "valeo" }).brands, ["valeo"]);
  assert.deepEqual(
    parseCatalogUrl({ brand: ["valeo", "bosch", "valeo", "Bad Key", "x'--"] })
      .brands,
    ["bosch", "valeo"],
  );
  assert.deepEqual(parseCatalogUrl({}).brands, []);
  const state = parseCatalogUrl({ brand: ["valeo", "bosch"], q: "филтър" });
  const href = catalogHref(state);
  assert.equal(
    href,
    "/catalog?q=%D1%84%D0%B8%D0%BB%D1%82%D1%8A%D1%80&brand=bosch&brand=valeo",
  );
  const back = Object.fromEntries(
    [...new URL(href, "http://x").searchParams.keys()].map((key) => [
      key,
      new URL(href, "http://x").searchParams.getAll(key),
    ]),
  );
  assert.deepEqual(parseCatalogUrl(back).brands, ["bosch", "valeo"]);
  assert.deepEqual(browseQueryFor(state, "bg")?.brands, ["bosch", "valeo"]);
  assert.equal(browseQueryFor(parseCatalogUrl({}), "bg")?.brands, undefined);
  // Changing brands returns to the first page.
  assert.equal(
    catalogHref({ ...state, page: 3 }, { brands: [] }),
    "/catalog?q=%D1%84%D0%B8%D0%BB%D1%82%D1%8A%D1%80",
  );
});

test("a browser query string parses like the server's parameters", () => {
  const state = parseCatalogSearch(
    "?category=car-care&q=%D1%84&brand=valeo&brand=bosch&available=1&page=2&lang=en",
  );
  assert.equal(state.category, "car-care");
  assert.equal(state.q, "ф");
  assert.deepEqual(state.brands, ["bosch", "valeo"]);
  assert.equal(state.available, true);
  assert.equal(state.page, 2);
  assert.deepEqual(parseCatalogSearch(""), EMPTY_CATALOG_STATE);
  assert.deepEqual(parseCatalogSearch("?brand=bosch").brands, ["bosch"]);
  // Hostile input falls back like on the server.
  assert.deepEqual(
    parseCatalogSearch("?sort=DROP&page=abc&available=yes"),
    EMPTY_CATALOG_STATE,
  );
  // Round trip.
  assert.equal(
    catalogHref(state, { page: state.page }),
    catalogHref(
      parseCatalogSearch(
        new URL(catalogHref(state, { page: state.page }), "http://x").search,
      ),
      { page: 2 },
    ),
  );
});
