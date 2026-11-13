"use client";
// Catalog data for client components. The root layout provides the category
// tree; products are looked up per SKU from /api/catalog/products when a
// component needs them (cart, favourites, repeat orders) and cached for the
// visit, so pages never ship the whole catalog.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CatalogTaxonomy, Product, ProductLookup } from "../lib/catalog";
import { MAX_LOOKUP_SKUS } from "../lib/catalog-lookup";

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
};

const CatalogContext = createContext<CatalogContextValue | null>(null);

async function fetchProducts(skus: string[]): Promise<Product[]> {
  const params = new URLSearchParams(skus.map((sku) => ["sku", sku]));
  const response = await fetch(`/api/catalog/products?${params}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Product lookup failed");
  return ((await response.json()) as { products: Product[] }).products;
}

export default function CatalogProvider({
  taxonomy,
  children,
}: {
  taxonomy: CatalogTaxonomy;
  children: React.ReactNode;
}) {
  // router.refresh() (e.g. a language switch) re-sends layout props as new
  // objects; keep the taxonomy stable unless its content changes.
  const signature = JSON.stringify(taxonomy);
  const [stable, setStable] = useState({ signature, taxonomy });
  if (stable.signature !== signature) setStable({ signature, taxonomy });

  // null marks a SKU that was looked up but is not in the catalog.
  const [loaded, setLoaded] = useState<ReadonlyMap<string, Product | null>>(
    () => new Map(),
  );
  const known = useRef(new Map<string, Product | null>());
  const inFlight = useRef(new Map<string, Promise<void>>());

  const lookup = useCallback<ProductLookup>(
    (sku) => known.current.get(sku) ?? undefined,
    [],
  );

  const ensureProducts = useCallback(
    async (skus: readonly string[]) => {
      const missing = [...new Set(skus)].filter(
        (sku) => !known.current.has(sku) && !inFlight.current.has(sku),
      );
      for (let i = 0; i < missing.length; i += MAX_LOOKUP_SKUS) {
        const chunk = missing.slice(i, i + MAX_LOOKUP_SKUS);
        // A failed lookup rejects (callers keep their data) and is retried the
        // next time those SKUs are needed.
        const request = fetchProducts(chunk).then((products) => {
          const found = new Map(products.map((p) => [p.sku, p]));
          for (const sku of chunk)
            known.current.set(sku, found.get(sku) ?? null);
          setLoaded(new Map(known.current));
        });
        for (const sku of chunk)
          inFlight.current.set(
            sku,
            request.finally(() => inFlight.current.delete(sku)),
          );
      }
      await Promise.all(
        [...new Set(skus)].map((sku) => inFlight.current.get(sku)),
      );
      return lookup;
    },
    [lookup],
  );

  const value = useMemo(
    () => ({
      taxonomy: stable.taxonomy,
      productBySku: (sku: string) => loaded.get(sku) ?? undefined,
      ensureProducts,
    }),
    [stable, loaded, ensureProducts],
  );
  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

export function useCatalog(): CatalogContextValue {
  const value = useContext(CatalogContext);
  if (!value) throw new Error("useCatalog must be used inside CatalogProvider");
  return value;
}
