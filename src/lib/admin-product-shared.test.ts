import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEuros } from "./admin-product-shared";

test("parseEuros converts euro amounts to cents", () => {
  assert.equal(parseEuros("45,90"), 4590);
  assert.equal(parseEuros(" 45.9 "), 4590);
  assert.equal(parseEuros("0.29"), 29);
  assert.equal(parseEuros("1.005".slice(0, 4)), 100);
  assert.equal(parseEuros("19.99"), 1999);
  assert.equal(parseEuros(""), null);
});

test("parseEuros rejects anything that is not a plain amount", () => {
  for (const value of [
    "abc",
    "1,2,3",
    "-5",
    "1e3",
    "12.345",
    "1 000",
    "9999999",
  ])
    assert.ok(Number.isNaN(parseEuros(value)), value);
});
