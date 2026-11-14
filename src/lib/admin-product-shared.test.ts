import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEuros,
  parsePercentBps,
  parseWholeNumber,
} from "./admin-product-shared";

test("parseEuros converts euro amounts to cents", () => {
  assert.equal(parseEuros("45,90"), 4590);
  assert.equal(parseEuros(" 45.9 "), 4590);
  assert.equal(parseEuros("0.29"), 29);
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

test("parsePercentBps converts VAT percentages and rejects blanks", () => {
  assert.equal(parsePercentBps("20"), 2000);
  assert.equal(parsePercentBps("9,5"), 950);
  assert.equal(parsePercentBps("0"), 0);
  assert.equal(parsePercentBps("   "), null);
  for (const value of ["abc", "1e2", "-1", "20.005", "1000"])
    assert.ok(Number.isNaN(parsePercentBps(value)), value);
});

test("parseWholeNumber accepts whole grams only", () => {
  assert.equal(parseWholeNumber(" 1200 "), 1200);
  assert.equal(parseWholeNumber(""), null);
  for (const value of ["abc", "12.5", "1e3", "-5", "1 000"])
    assert.ok(Number.isNaN(parseWholeNumber(value)), value);
});
