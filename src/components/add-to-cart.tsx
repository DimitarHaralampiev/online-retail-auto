"use client";

import Link from "next/link";
import { useState } from "react";
import type { Product } from "../lib/catalog";
import { availableStock } from "../lib/inventory";
import { useCart } from "./cart-provider";
import Icon from "./icon";

export default function AddToCart({ product }: { product: Product }) {
  const { items, ready, add } = useCart();
  const [added, setAdded] = useState(false);
  const quantity =
    items.find((item) => item.sku === product.sku)?.quantity ?? 0;
  const available = availableStock(product.stock);
  return (
    <div className="add-to-cart">
      <button
        className="button"
        type="button"
        disabled={!ready || quantity >= available}
        onClick={() => {
          add(product.sku);
          setAdded(true);
        }}
      >
        {available === 0
          ? "Няма свободни бройки"
          : quantity >= available
            ? "Всички свободни бройки са в количката"
            : "Добави в демо количката"}
        <Icon name="cart" />
      </button>
      <p role="status">
        {added && (
          <>
            Добавено. <Link href="/cart">Към количката →</Link>
          </>
        )}
      </p>
    </div>
  );
}
