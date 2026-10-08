"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  CART_STORAGE_KEY,
  normalizeCart,
  readStoredCart,
  type CartItem,
} from "../lib/cart";

type CartContextValue = {
  items: CartItem[];
  ready: boolean;
  storageWarning: string;
  add: (sku: string) => void;
  setQuantity: (sku: string, quantity: number) => void;
  remove: (sku: string) => void;
};
const CartContext = createContext<CartContextValue | null>(null);

export default function CartProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  useEffect(() => {
    try {
      setItems(readStoredCart(localStorage.getItem(CART_STORAGE_KEY)));
    } catch {
      setStorageWarning(
        "Браузърът не позволява запазване на количката. Тя работи само до презареждане.",
      );
    }
    setReady(true);
  }, []);
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
  return (
    <CartContext.Provider
      value={{
        items,
        ready,
        storageWarning,
        add: (sku) =>
          setItems((previous) =>
            normalizeCart([...previous, { sku, quantity: 1 }]),
          ),
        setQuantity: (sku, quantity) =>
          setItems((previous) =>
            normalizeCart(
              previous.map((item) =>
                item.sku === sku ? { ...item, quantity } : item,
              ),
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
