"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  CART_STORAGE_KEY,
  normalizeCart,
  storedCartItems,
  type CartItem,
} from "../lib/cart";
import { useCatalog } from "./catalog-provider";

type CartContextValue = {
  items: CartItem[];
  ready: boolean;
  storageWarning: string;
  /** SKUs in the cart whose products could not be loaded yet. */
  unresolved: string[];
  retryProducts: () => Promise<void>;
  /** Resolves once the cart is updated; rejects if products cannot load. */
  add: (sku: string) => Promise<void>;
  addItems: (items: CartItem[]) => Promise<void>;
  setQuantity: (sku: string, quantity: number) => Promise<void>;
  remove: (sku: string) => void;
  clear: () => void;
};
const CartContext = createContext<CartContextValue | null>(null);

export default function CartProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { ensureProducts, productBySku } = useCatalog();
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  // Restore the stored cart once its products are loaded. If the lookup
  // fails, keep the stored items as they are rather than dropping them.
  useEffect(() => {
    let stored: CartItem[] = [];
    try {
      stored = storedCartItems(localStorage.getItem(CART_STORAGE_KEY));
    } catch {
      setStorageWarning(
        "Браузърът не позволява запазване на количката. Тя работи само до презареждане.",
      );
    }
    let cancelled = false;
    ensureProducts(stored.map((item) => item.sku)).then(
      (lookup) => {
        if (cancelled) return;
        setItems(normalizeCart(stored, lookup));
        setReady(true);
      },
      () => {
        if (cancelled) return;
        setItems(stored);
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ensureProducts]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify({ version: 1, items }),
      );
    } catch {
      setStorageWarning(
        "Браузърът не позволява запазване на количката. Тя работи само до презареждане.",
      );
    }
  }, [items, ready]);
  // Changes load the products of the new items and of everything already in
  // the cart (which may be unverified after a failed restore), so stock
  // limits apply and no stored item is dropped for lack of data. If the
  // lookup fails, the cart is left unchanged.
  const current = useRef(items);
  useEffect(() => {
    current.current = items;
  }, [items]);
  async function update(
    skus: string[],
    change: (previous: CartItem[]) => CartItem[],
  ) {
    const lookup = await ensureProducts([
      ...skus,
      ...current.current.map((item) => item.sku),
    ]);
    setItems((previous) => normalizeCart(change(previous), lookup));
  }
  // Items whose products have not loaded (only after a failed restore).
  const unresolved = ready
    ? items.filter((item) => !productBySku(item.sku)).map((item) => item.sku)
    : [];
  return (
    <CartContext.Provider
      value={{
        unresolved,
        // Loads missing products again; on success the cart is normalised.
        retryProducts: () => update([], (previous) => previous),
        clear: () => setItems([]),
        items,
        ready,
        storageWarning,
        addItems: (incoming) =>
          update(
            incoming.map((item) => item.sku),
            (previous) => [...previous, ...incoming],
          ),
        add: (sku) =>
          update([sku], (previous) => [...previous, { sku, quantity: 1 }]),
        setQuantity: (sku, quantity) =>
          update([sku], (previous) =>
            previous.map((item) =>
              item.sku === sku ? { ...item, quantity } : item,
            ),
          ),
        remove: (sku) =>
          setItems((previous) => previous.filter((item) => item.sku !== sku)),
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("CartProvider is required.");
  return context;
}
