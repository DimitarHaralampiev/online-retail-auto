import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LOOKUP_SKUS, parseLookupSkus } from "./catalog-lookup";

const params = (...skus: string[]) =>
  new URLSearchParams(skus.map((sku) => ["sku", sku]));

test("lookup SKUs are trimmed and de-duplicated in order", () => {
  assert.deepEqual(parseLookupSkus(params(" B ", "A", "B")), {
    skus: ["B", "A"],
  });
  assert.deepEqual(parseLookupSkus(new URLSearchParams()), { skus: [] });
});

test("lookups reject empty, oversized or too many SKUs", () => {
  assert.ok("error" in parseLookupSkus(params("A", " ")));
  assert.ok("error" in parseLookupSkus(params("X".repeat(51))));
  assert.ok(
    "error" in
      parseLookupSkus(
        params(
          ...Array.from({ length: MAX_LOOKUP_SKUS + 1 }, (_, i) => `S${i}`),
        ),
      ),
  );
  assert.ok(
    !(
      "error" in
      parseLookupSkus(
        params(...Array.from({ length: MAX_LOOKUP_SKUS }, (_, i) => `S${i}`)),
      )
    ),
  );
});
