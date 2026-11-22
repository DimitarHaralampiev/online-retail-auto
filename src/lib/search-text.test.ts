import assert from "node:assert/strict";
import { test } from "node:test";
import { latinize } from "./search-text";

test("latinize transliterates Bulgarian and strips accents", () => {
  assert.equal(latinize("Въздушен ФИЛТЪР"), "vazdushen filtar");
  assert.equal(
    latinize("Щипка, Юта, Ябълка, Цвят, Хром, Жега, Чаша, Шум"),
    "shtipka, yuta, yabalka, tsvyat, hrom, zhega, chasha, shum",
  );
  assert.equal(latinize("Škoda Citroën"), "skoda citroen");
  assert.equal(latinize("Mercedes-Benz 2.0"), "mercedes-benz 2.0");
});
