"use client";
// Catalog data for client components, loaded on the server by the root layout.
// The product list keeps the current small demo catalog working; #27 replaces
// it with per-SKU lookups so pages do not ship the whole catalog.
import { createContext, useContext, useMemo } from "react";
import type { CatalogTaxonomy, Product } from "../lib/catalog";

type CatalogContextValue = {
  taxonomy: CatalogTaxonomy;
  products: Product[];
  productBySku: (sku: string) => Product | undefined;
};

const CatalogContext = createContext<CatalogContextValue | null>(null);

export default function CatalogProvider({
  taxonomy,
  products,
  children,
}: {
  taxonomy: CatalogTaxonomy;
  products: Product[];
  children: React.ReactNode;
}) {
  const value = useMemo(() => {
    const bySku = new Map(products.map((product) => [product.sku, product]));
    return {
      taxonomy,
      products,
      productBySku: (sku: string) => bySku.get(sku),
    };
  }, [taxonomy, products]);
  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}

export function useCatalog(): CatalogContextValue {
  const value = useContext(CatalogContext);
  if (!value) throw new Error("useCatalog must be used inside CatalogProvider");
  return value;
}
