import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attributeParams,
  attributeText,
  attributeValueKey,
  MAX_ATTRIBUTE_FILTERS,
  parseAttributeFilters,
  toggleAttribute,
} from "./attributes";
import {
  catalogHref,
  parseCatalogSearch,
  parseCatalogUrl,
} from "./catalog-url";

test("value keys ignore case, spacing and the decimal sign, not the sign", () => {
  assert.equal(attributeValueKey("  5W-30 "), "5w-30");
  assert.equal(attributeValueKey("1,5"), attributeValueKey("1.5"));
  assert.equal(attributeValueKey("Черен  мат"), "черен мат");
  assert.notEqual(attributeValueKey("-20"), attributeValueKey("20"));
  // A comma that is not a decimal sign stays.
  assert.equal(attributeValueKey("H4, H7"), "h4, h7");
});

test("filters are parsed into one canonical form", () => {
  assert.deepEqual(
    parseAttributeFilters([
      "viscosity:5W-40",
      "viscosity:5w-30",
      "viscosity:5W-30",
      "length:450",
      "ratio:1:2", // only the first colon separates
    ]),
    { length: ["450"], ratio: ["1:2"], viscosity: ["5w-30", "5w-40"] },
  );
});

test("malformed filters are dropped", () => {
  assert.deepEqual(
    parseAttributeFilters([
      "",
      ":x",
      "viscosity",
      "viscosity:",
      "viscosity:   ",
      "Viscosity:5w-30",
      "bad key:1",
      `${"k".repeat(41)}:1`,
      `viscosity:${"x".repeat(101)}`,
      "viscosity:a\u0000b",
      42,
      null,
      "__proto__:1",
    ]),
    {},
  );
  const many = Array.from({ length: 50 }, (_, i) => `size:${i}`);
  assert.equal(
    attributeParams(parseAttributeFilters(many)).length,
    MAX_ATTRIBUTE_FILTERS,
  );
});

test("a key every object already has is refused, not a crash", () => {
  assert.deepEqual(parseAttributeFilters(["constructor:1"]), {});
  assert.deepEqual(parseCatalogSearch("?attr=constructor:1").attributes, {});
});

test("toggling a value keeps the others and drops empty keys", () => {
  const one = toggleAttribute({}, "viscosity", "5w-30", true);
  const two = toggleAttribute(one, "length", "450", true);
  assert.deepEqual(two, { length: ["450"], viscosity: ["5w-30"] });
  assert.deepEqual(toggleAttribute(two, "viscosity", "5w-30", true), two);
  assert.deepEqual(toggleAttribute(two, "viscosity", "5w-30", false), {
    length: ["450"],
  });
});

test("values show with their unit", () => {
  assert.equal(attributeText("450", "mm"), "450 mm");
  assert.equal(attributeText("5W-30", ""), "5W-30");
});

test("the catalog URL round-trips attribute filters", () => {
  const state = parseCatalogUrl({
    attr: ["viscosity:5W-30", "tip:1/2 & more", "junk"],
    page: "3",
  });
  const href = catalogHref(state, { page: 3 });
  assert.deepEqual(parseCatalogSearch(new URL(href, "http://x").search), state);
  assert.deepEqual(state.attributes, {
    tip: ["1/2 & more"],
    viscosity: ["5w-30"],
  });
  // Changing a filter returns to the first page.
  assert.ok(!catalogHref(state, { attributes: {} }).includes("page="));
  assert.deepEqual(parseCatalogUrl({ attr: "viscosity:5w-30" }).attributes, {
    viscosity: ["5w-30"],
  });
});
