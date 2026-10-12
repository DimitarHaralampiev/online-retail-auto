"use client";
import Localize from "./localize";

import Link from "next/link";
import { useState } from "react";
import type { Product } from "../lib/catalog";
import { availableStock } from "../lib/inventory";
import { useCart } from "./cart-provider";
import Icon from "./icon";

export default function AddToCart({
  product,
  allowQuantity = false,
}: {
  product: Product;
  allowQuantity?: boolean;
}) {
  const { items, ready, add, addItems } = useCart();
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const quantity =
    items.find((item) => item.sku === product.sku)?.quantity ?? 0;
  const available = availableStock(product.stock);
  const remaining = Math.max(0, available - quantity);
  const quantityToAdd = Math.min(selectedQuantity, remaining);
  return (
    <Localize>
      {
        <div className="add-to-cart">
          {allowQuantity && remaining > 0 && (
            <label className="product-quantity">
              Количество
              <input
                type="number"
                min={1}
                max={remaining}
                step={1}
                disabled={!ready}
                value={Math.min(selectedQuantity, remaining)}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isSafeInteger(value) && value > 0)
                    setSelectedQuantity(Math.min(value, remaining));
                }}
              />
            </label>
          )}
          <button
            className="button"
            type="button"
            disabled={!ready || quantity >= available}
            onClick={() => {
              if (allowQuantity)
                addItems([{ sku: product.sku, quantity: quantityToAdd }]);
              else add(product.sku);
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
      }
    </Localize>
  );
}
