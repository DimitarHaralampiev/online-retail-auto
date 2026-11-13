import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDemoSeedTarget, type DemoSeedEnv } from "./catalog-seed";

const local = "postgresql://auto:secret@127.0.0.1:5433/auto";

test("the demo seed may write to local databases outside production", () => {
  for (const url of [
    local,
    "postgresql://auto:secret@localhost/auto",
    "postgresql://auto:secret@[::1]:5432/auto?sslmode=disable",
  ])
    assert.doesNotThrow(() => assertDemoSeedTarget({ DATABASE_URL: url }), url);
});

test("the demo seed refuses remote, overridden, production or missing targets", () => {
  const refused: [DemoSeedEnv, RegExp][] = [
    [{}, /Set DATABASE_URL/],
    [
      { DATABASE_URL: "postgresql://u:p@db.example.com/shop" },
      /db\.example\.com\/shop/,
    ],
    [{ DATABASE_URL: `${local}?host=db.example.com` }, /overrides the host/],
    [{ DATABASE_URL: `${local}?hostaddr=10.0.0.5` }, /overrides the host/],
    [{ DATABASE_URL: local, NODE_ENV: "production" }, /NODE_ENV=production/],
    [{ DATABASE_URL: "not a url" }, /not a valid connection URL/],
  ];
  for (const [env, error] of refused)
    assert.throws(() => assertDemoSeedTarget(env), error, JSON.stringify(env));
});

test("ALLOW_DEMO_SEED=1 is an explicit override, but a URL is still required", () => {
  assert.doesNotThrow(() =>
    assertDemoSeedTarget({
      DATABASE_URL: "postgresql://u:p@staging.example.com/demo",
      NODE_ENV: "production",
      ALLOW_DEMO_SEED: "1",
    }),
  );
  assert.throws(
    () => assertDemoSeedTarget({ ALLOW_DEMO_SEED: "1" }),
    /Set DATABASE_URL/,
  );
});
