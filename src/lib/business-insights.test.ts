import test from "node:test";
import assert from "node:assert/strict";
import { validateInsightSources } from "./business-insights";
test("analytics accepts verified snapshot and product references", () => {
  assert.doesNotThrow(() =>
    validateInsightSources(
      ["snapshot-id", "SKU-1"],
      [{ id: "snapshot-id" }, { id: "SKU-1" }],
    ),
  );
});
test("analytics rejects fabricated references rather than showing them", () => {
  assert.throws(
    () => validateInsightSources(["invented-source"], [{ id: "snapshot-id" }]),
    /Невалиден отговор/,
  );
});
