import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog, catalogSource } from "./catalog-server";

test("the catalog source defaults to static and accepts postgres", () => {
  assert.equal(catalogSource(undefined), "static");
  assert.equal(catalogSource(""), "static");
  assert.equal(catalogSource("static"), "static");
  assert.equal(catalogSource("postgres"), "postgres");
});

test("an unknown catalog source fails loudly instead of falling back", () => {
  assert.throws(() => catalogSource("postgresql"), /CATALOG_SOURCE must be/);
});

test("business logic reads the catalog in Bulgarian by default", async () => {
  delete process.env.CATALOG_SOURCE;
  assert.equal(
    (await catalog().getProduct("DEMO-003"))?.name,
    "Въздушен филтър",
  );
  assert.equal(
    (await catalog("en").getProduct("DEMO-003"))?.name,
    "Air filter",
  );
});
