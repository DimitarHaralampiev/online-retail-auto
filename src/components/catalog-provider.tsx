"use client";
// Catalog data for client components. The root layout provides the category
// tree; products are looked up per SKU from /api/catalog/products when a
// component needs them (cart, favourites, repeat orders) and cached for the
// visit, so pages never ship the whole catalog.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { CatalogTaxonomy, Product, ProductLookup } from "../lib/catalog";
import { MAX_LOOKUP_SKUS } from "../lib/catalog-lookup";
import type { Locale } from "../lib/i18n/locale";
import { createProductCache } from "../lib/product-cache";

type CatalogContextValue = {
  taxonomy: CatalogTaxonomy;
  /** Products loaded so far, for rendering. */
  productBySku: ProductLookup;
  /**
   * Loads the given SKUs (each at most once per visit) and resolves with a
   * lookup that sees them; rejects when the lookup request fails. Stable
   * identity: safe in effect dependencies.
   */
  ensureProducts: (skus: readonly string[]) => Promise<ProductLookup>;
  /** Makes products the page already shows known without a lookup. */
  primeProducts: (products: readonly Product[]) => void;
};

const CatalogContext = createContext<CatalogContextValue | null>(null);

async function fetchProducts(
  skus: string[],
  locale: Locale,
): Promise<Product[]> {
  const params = new URLSearchParams(skus.map((sku) => ["sku", sku]));
  params.set("locale", locale);
  const response = await fetch(`/api/catalog/products?${params}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Product lookup failed");
  return ((await response.json()) as { products: Product[] }).products;
}

/** The visit's product cache with the stable functions handed to consumers. */
function createCatalogCache(locale: Locale) {
  const cache = createProductCache(fetchProducts, locale, MAX_LOOKUP_SKUS);
  return {
    cache,
    async ensureProducts(skus: readonly string[]): Promise<ProductLookup> {
      await cache.ensure(skus);
      return cache.get;
    },
  };
}

export default function CatalogProvider({
  taxonomy,
  locale,
  children,
}: {
  taxonomy: CatalogTaxonomy;
  /** Products are looked up with names in this locale. */
  locale: Locale;
  children: React.ReactNode;
}) {
  // router.refresh() (e.g. a language switch) re-sends layout props as new
  // objects; keep the taxonomy stable unless its content changes.
  const signature = JSON.stringify(taxonomy);
  const [stable, setStable] = useState({ signature, taxonomy });
  if (stable.signature !== signature) setStable({ signature, taxonomy });

  const [{ cache, ensureProducts }] = useState(() =>
    createCatalogCache(locale),
  );
  const version = useSyncExternalStore(
    cache.subscribe,
    cache.version,
    cache.version,
  );
  useEffect(() => cache.setLocale(locale), [cache, locale]);
  // Names that could not be refreshed offline are fetched when back online.
  useEffect(() => {
    window.addEventListener("online", cache.retryStale);
    return () => window.removeEventListener("online", cache.retryStale);
  }, [cache]);

  const value = useMemo(
    () => ({
      taxonomy: stable.taxonomy,
      // A new function per cache version, so consumers render new data.
      productBySku: lookupAt(cache.get, version),
      ensureProducts,
      primeProducts: cache.prime,
    }),
    [stable, cache, version, ensureProducts],
  );
  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

/** The lookup as a new function for each version of the cache. */
function lookupAt(get: ProductLookup, version: number): ProductLookup {
  void version;
  return (sku) => get(sku);
}

export function useCatalog(): CatalogContextValue {
  const value = useContext(CatalogContext);
  if (!value) throw new Error("useCatalog must be used inside CatalogProvider");
  return value;
}
