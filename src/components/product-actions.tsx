"use client";
import Link from "next/link";
import { useState } from "react";
import { useCustomerFeatures } from "./customer-provider";
import { useAccount } from "./account-provider";
import type { Product } from "../lib/catalog";
import { availableStock } from "../lib/inventory";
export default function ProductActions({ product }: { product: Product }) {
  const { data, ready, busy, mutate } = useCustomerFeatures();
  const { customer } = useAccount();
  const [error, setError] = useState("");
  const favorite = data.favorites.includes(product.sku);
  const price = data.alerts.some(
    (a) => a.sku === product.sku && a.kind === "price" && a.active,
  );
  const stock = data.alerts.some(
    (a) => a.sku === product.sku && a.kind === "stock" && a.active,
  );
  async function act(action: unknown) {
    setError("");
    try {
      await mutate(action);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="product-customer-actions">
      <button
        className={`favorite-button ${favorite ? "is-favorite" : ""}`}
        type="button"
        aria-label={`${favorite ? "Премахни от" : "Добави в"} любими: ${product.name}`}
        aria-pressed={favorite}
        disabled={!ready || busy}
        onClick={() =>
          act({ action: "favorite", sku: product.sku, enabled: !favorite })
        }
      >
        <span aria-hidden="true">{favorite ? "♥" : "♡"}</span>{" "}
        {favorite ? "В любими" : "Запази в любими"}
      </button>
      {customer &&
        favorite &&
        (data.preferences.price ? (
          <label className="product-alert-toggle">
            <input
              type="checkbox"
              checked={price}
              disabled={!ready || busy}
              onChange={(e) =>
                act({
                  action: "alert",
                  sku: product.sku,
                  kind: "price",
                  enabled: e.target.checked,
                })
              }
            />{" "}
            Извести ме при намаление
          </label>
        ) : (
          <Link href="/account#services">Активирай имейли при намаление</Link>
        ))}
      {availableStock(product.stock) === 0 &&
        (customer ? (
          data.preferences.stock ? (
            <button
              className="text-link"
              type="button"
              disabled={!ready || busy}
              onClick={() =>
                act({
                  action: "alert",
                  sku: product.sku,
                  kind: "stock",
                  enabled: !stock,
                })
              }
            >
              {stock
                ? "Спри известието за наличност"
                : "Извести ме при наличност"}
            </button>
          ) : (
            <Link href="/account#services">Активирай имейли при наличност</Link>
          )
        ) : (
          <Link href="/account">Влез за известие при наличност</Link>
        ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
