// The browser's product cache (#78, #84): products are looked up per SKU
// (cart, favourites, repeat orders) and kept for the visit, in the visitor's
// language. Framework-free so it can be unit-tested; CatalogProvider wraps it.
//
// - Each SKU is fetched once; concurrent requests share one fetch.
// - A SKU the catalog does not have is remembered as not found.
// - A failed fetch rejects that call and is retried the next time.
// - After a language switch every product is fetched again in the new
//   language. Until then the previous names stay visible, and callers that
//   already know a product never wait for (or fail with) that refresh.
// - A refresh that failed is retried on the next lookup or when the browser
//   comes back online.
import type { Product } from "./catalog";
import type { Locale } from "./i18n/locale";

export type ProductFetcher = (
  skus: string[],
  locale: Locale,
) => Promise<Product[]>;

type Entry = { locale: Locale; product: Product | null };

export type ProductCache = ReturnType<typeof createProductCache>;

export function createProductCache(
  fetcher: ProductFetcher,
  initialLocale: Locale,
  chunkSize: number,
) {
  const known = new Map<string, Entry>();
  // Keyed by "locale:sku": one request per SKU and language at a time.
  const inFlight = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let locale = initialLocale;
  let version = 0;
  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  // Loads SKUs in the current language. `refresh` also reloads entries held
  // in another language; otherwise only unknown SKUs are fetched. A response
  // for a language that is no longer current is stored only where nothing is
  // known yet, and then triggers a refresh, so late or out-of-order responses
  // cannot leave the wrong language behind.
  function load(skus: readonly string[], refresh: boolean): Promise<void> {
    const wanted = locale;
    const key = (sku: string) => `${wanted}:${sku}`;
    const unique = [...new Set(skus)];
    const missing = unique.filter((sku) => {
      const entry = known.get(sku);
      const needed = refresh ? entry?.locale !== wanted : !entry;
      return needed && !inFlight.has(key(sku));
    });
    for (let i = 0; i < missing.length; i += chunkSize) {
      const chunk = missing.slice(i, i + chunkSize);
      const request = fetcher(chunk, wanted).then((products) => {
        const found = new Map(products.map((p) => [p.sku, p]));
        for (const sku of chunk)
          if (wanted === locale || !known.has(sku))
            known.set(sku, { locale: wanted, product: found.get(sku) ?? null });
        notify();
        if (wanted !== locale) load(chunk, true).catch(() => undefined);
      });
      for (const sku of chunk)
        inFlight.set(
          key(sku),
          request.finally(() => inFlight.delete(key(sku))),
        );
    }
    return Promise.all(unique.map((sku) => inFlight.get(key(sku)))).then(
      () => undefined,
    );
  }

  /** Known products whose names are still in another language. */
  const stale = () =>
    [...known].filter(([, e]) => e.locale !== locale).map(([sku]) => sku);

  return {
    get(sku: string): Product | undefined {
      return known.get(sku)?.product ?? undefined;
    },
    /**
     * Resolves once every given SKU is known (found or not found); rejects
     * when a lookup for an unknown SKU fails. Known SKUs never wait.
     */
    async ensure(skus: readonly string[]): Promise<void> {
      const pending = stale();
      if (pending.length) load(pending, true).catch(() => undefined);
      await load(
        skus.filter((sku) => !known.has(sku)),
        false,
      );
    },
    /**
     * Adds products the server already rendered in the current language, so
     * using one needs no lookup. Products already held are left alone: the
     * page may be older than the cached answer.
     */
    prime(products: readonly Product[]) {
      let changed = false;
      for (const product of products)
        if (!known.get(product.sku)?.product) {
          known.set(product.sku, { locale, product });
          changed = true;
        }
      if (changed) notify();
    },
    /** Switches language and refreshes every product loaded or loading. */
    setLocale(next: Locale) {
      if (next === locale) return;
      locale = next;
      const loading = [...inFlight.keys()].map((k) =>
        k.slice(k.indexOf(":") + 1),
      );
      load([...known.keys(), ...loading], true).catch(() => undefined);
    },
    /** Retries refreshes that failed (e.g. when the browser is online again). */
    retryStale() {
      const pending = stale();
      if (pending.length) load(pending, true).catch(() => undefined);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Changes whenever cached data changes (for useSyncExternalStore). */
    version: () => version,
  };
}
