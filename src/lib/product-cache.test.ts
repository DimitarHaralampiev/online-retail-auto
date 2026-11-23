import assert from "node:assert/strict";
import { test } from "node:test";
import type { Product } from "./catalog";
import type { Locale } from "./i18n/locale";
import { createProductCache } from "./product-cache";

type Call = {
  skus: string[];
  locale: Locale;
  resolve: (products: Product[]) => void;
  reject: (error: Error) => void;
};

/** A fetcher whose answers the test releases by hand. */
function controlledFetcher() {
  const calls: Call[] = [];
  const fetcher = (skus: string[], locale: Locale) =>
    new Promise<Product[]>((resolve, reject) =>
      calls.push({ skus, locale, resolve, reject }),
    );
  return { calls, fetcher };
}

const product = (sku: string, name: string) => ({ sku, name }) as Product;
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("each SKU is fetched once and concurrent lookups share the request", async () => {
  const { calls, fetcher } = controlledFetcher();
  const cache = createProductCache(fetcher, "bg", 50);
  const first = cache.ensure(["A", "B", "A"]);
  const second = cache.ensure(["B"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].skus, ["A", "B"]);
  calls[0].resolve([product("A", "Филтър"), product("B", "Чистачки")]);
  await Promise.all([first, second]);
  assert.equal(cache.get("A")?.name, "Филтър");
  await cache.ensure(["A", "B"]);
  assert.equal(calls.length, 1, "known products are not fetched again");
});

test("unknown SKUs are remembered as not found", async () => {
  const { calls, fetcher } = controlledFetcher();
  const cache = createProductCache(fetcher, "bg", 50);
  const pending = cache.ensure(["GONE"]);
  calls[0].resolve([]);
  await pending;
  assert.equal(cache.get("GONE"), undefined);
  await cache.ensure(["GONE"]);
  assert.equal(calls.length, 1);
});

test("a failed lookup rejects and is retried next time", async () => {
  const { calls, fetcher } = controlledFetcher();
  const cache = createProductCache(fetcher, "bg", 50);
  const failing = cache.ensure(["A"]);
  calls[0].reject(new Error("offline"));
  await assert.rejects(failing, /offline/);
  const retry = cache.ensure(["A"]);
  assert.equal(calls.length, 2);
  calls[1].resolve([product("A", "Филтър")]);
  await retry;
  assert.equal(cache.get("A")?.name, "Филтър");
});

test("lookups are split into chunks", async () => {
  const { calls, fetcher } = controlledFetcher();
  const cache = createProductCache(fetcher, "bg", 2);
  const pending = cache.ensure(["A", "B", "C"]);
  assert.deepEqual(
    calls.map((c) => c.skus),
    [["A", "B"], ["C"]],
  );
  for (const call of calls) call.resolve(call.skus.map((s) => product(s, s)));
  await pending;
});

test("after a language switch known products never wait for the refresh (#84 L1)", async () => {
  const { calls, fetcher } = controlledFetcher();
  const cache = createProductCache(fetcher, "bg", 50);
  const initial = cache.ensure(["A"]);
  calls[0].resolve([product("A", "Филтър")]);
  await initial;
  cache.setLocale("en");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].locale, "en");
  // A cart change right after the switch: resolves at once with the old name.
  await cache.ensure(["A"]);
  assert.equal(cache.get("A")?.name, "Филтър");
  // Even when the refresh then fails, the cart was not affected.
  calls[1].reject(new Error("offline"));
  await tick();
  assert.equal(cache.get("A")?.name, "Филтър");
});

test("a failed refresh is retried on the next lookup and when online (#84 L2)", async () => {
  const { calls, fetcher } = controlledFetcher();
  const cache = createProductCache(fetcher, "bg", 50);
  const initial = cache.ensure(["A"]);
  calls[0].resolve([product("A", "Филтър")]);
  await initial;
  cache.setLocale("en");
  calls[1].reject(new Error("offline"));
  await tick();
  // The next lookup (any SKU) retries the stale refresh in the background.
  const next = cache.ensure(["B"]);
  const retried = calls.find((c, i) => i > 1 && c.skus.includes("A"));
  assert.ok(retried, "refresh of A retried");
  assert.equal(retried.locale, "en");
  retried.resolve([product("A", "Air filter")]);
  calls.find((c) => c.skus.includes("B"))!.resolve([product("B", "Wipers")]);
  await next;
  await tick();
  assert.equal(cache.get("A")?.name, "Air filter");
  // Nothing stale left: no further refreshes.
  const before = calls.length;
  cache.retryStale();
  assert.equal(calls.length, before);
});

test("retryStale refreshes products still in the old language", async () => {
  const { calls, fetcher } = controlledFetcher();
  const cache = createProductCache(fetcher, "bg", 50);
  const initial = cache.ensure(["A"]);
  calls[0].resolve([product("A", "Филтър")]);
  await initial;
  cache.setLocale("en");
  calls[1].reject(new Error("offline"));
  await tick();
  cache.retryStale();
  assert.equal(calls.length, 3);
  calls[2].resolve([product("A", "Air filter")]);
  await tick();
  assert.equal(cache.get("A")?.name, "Air filter");
});

test("a late answer in the old language cannot overwrite the new one", async () => {
  const { calls, fetcher } = controlledFetcher();
  const cache = createProductCache(fetcher, "bg", 50);
  const first = cache.ensure(["A"]); // requested in Bulgarian
  cache.setLocale("en"); // refresh of the in-flight SKU in English
  const english = calls.find((c) => c.locale === "en")!;
  english.resolve([product("A", "Air filter")]);
  await tick();
  calls[0].resolve([product("A", "Филтър")]); // the Bulgarian answer arrives late
  await first;
  await tick();
  assert.equal(cache.get("A")?.name, "Air filter");
});

test("subscribers hear about every change", async () => {
  const { calls, fetcher } = controlledFetcher();
  const cache = createProductCache(fetcher, "bg", 50);
  let heard = 0;
  const unsubscribe = cache.subscribe(() => {
    heard += 1;
  });
  const before = cache.version();
  const pending = cache.ensure(["A"]);
  calls[0].resolve([product("A", "Филтър")]);
  await pending;
  assert.equal(heard, 1);
  assert.notEqual(cache.version(), before);
  unsubscribe();
  cache.setLocale("en");
  calls[1].resolve([product("A", "Air filter")]);
  await tick();
  assert.equal(heard, 1);
});
