"use client";
import { useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useLocale } from "./locale-provider";
import type { Product } from "../lib/catalog";
import { availableStock } from "../lib/inventory";
import ProductPrice from "./product-price";
import AddToCart from "./add-to-cart";
export default function ProductQuickView({ product }: { product: Product }) {
  const { locale, t } = useLocale();
  const en = locale === "en";
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="quick-view-trigger"
        onClick={() => dialog.current?.showModal()}
      >
        {en ? "Quick view" : "Бърз преглед"} <span aria-hidden="true">↗</span>
      </button>
      <dialog
        ref={dialog}
        className="quick-view-dialog"
        aria-label={`${en ? "Quick view" : "Бърз преглед"}: ${t(product.name)}`}
        onClose={() => button.current?.focus()}
        onClick={(e) => {
          if (e.target === dialog.current) {
            const r = dialog.current.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              dialog.current.close();
          }
        }}
      >
        <button
          type="button"
          autoFocus
          className="quick-view-close"
          onClick={() => dialog.current?.close()}
          aria-label={en ? "Close preview" : "Затвори прегледа"}
        >
          ×
        </button>
        <div className="quick-view-layout">
          <div className="quick-view-image">
            <Image
              src={product.image}
              alt={`${en ? "Illustration" : "Илюстрация"}: ${t(product.name)}`}
              fill
              sizes="(max-width: 700px) 90vw, 400px"
            />
            <span className="product-demo-tag">{t("ДЕМО")}</span>
          </div>
          <div className="quick-view-info">
            <p className="eyebrow">{t(product.category)}</p>
            <h2>{t(product.name)}</h2>
            <p>{t(product.description)}</p>
            <p className="quick-view-stock">
              {product.sku} · {availableStock(product.stock)}{" "}
              {en ? "available demo units" : "свободни демо бройки"}
            </p>
            <ProductPrice product={product} />
            <AddToCart product={product} allowQuantity />
            <Link
              className="text-link"
              href={`/catalog/${product.sku}`}
              onClick={() => dialog.current?.close()}
            >
              {en ? "All product details →" : "Всички детайли за продукта →"}
            </Link>
            <p className="note">
              {en
                ? "Demo product and illustrative prices."
                : "Демонстрационен продукт и примерни цени."}
            </p>
          </div>
        </div>
      </dialog>
    </>
  );
}
