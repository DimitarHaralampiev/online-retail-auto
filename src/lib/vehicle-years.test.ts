import assert from "node:assert/strict";
import { test } from "node:test";
import { generationsInYear, modelYears } from "./vehicle-years";

const generations = [
  { id: "a", yearFrom: 2010, yearTo: 2013 },
  { id: "b", yearFrom: 2013, yearTo: null },
];

test("modelYears lists every covered year once, newest first, up to now", () => {
  assert.deepEqual(
    modelYears(generations, 2015),
    [2015, 2014, 2013, 2012, 2011, 2010],
  );
  // A generation announced for the future does not list future years.
  assert.deepEqual(
    modelYears([{ yearFrom: 2024, yearTo: 2030 }], 2025),
    [2025, 2024],
  );
  assert.deepEqual(modelYears([], 2025), []);
});

test("generationsInYear finds both generations in a changeover year", () => {
  assert.deepEqual(
    generationsInYear(generations, 2013, 2015).map((g) => g.id),
    ["a", "b"],
  );
  assert.deepEqual(
    generationsInYear(generations, 2011, 2015).map((g) => g.id),
    ["a"],
  );
  assert.deepEqual(generationsInYear(generations, 2009, 2015), []);
});
