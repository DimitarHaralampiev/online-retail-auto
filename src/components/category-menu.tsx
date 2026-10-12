"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { categories, demoProducts } from "../lib/catalog";
import { subcategories } from "../lib/catalog-browse";
import { useLocale } from "./locale-provider";
export default function CategoryMenu() {
  const { t, locale } = useLocale();
  const details = useRef<HTMLDetailsElement>(null);
  const en = locale === "en";
  useEffect(() => {
    function outside(e: PointerEvent) {
      if (details.current && !details.current.contains(e.target as Node))
        details.current.open = false;
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape" && details.current?.open) {
        details.current.open = false;
        details.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  function close() {
    if (details.current) details.current.open = false;
  }
  return (
    <details className="category-menu" ref={details}>
      <summary>
        {en ? "All categories" : "Всички категории"}{" "}
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="category-menu-panel">
        <div className="category-menu-intro">
          <strong>
            {en ? "Find what your car needs." : "Намери нужното за автомобила."}
          </strong>
          <Link href="/catalog" onClick={close}>
            {en ? "Explore the catalog →" : "Разгледай каталога →"}
          </Link>
        </div>
        <div className="category-menu-columns">
          {categories.map((category) => (
            <section key={category}>
              <Link
                href={{ pathname: "/catalog", query: { category } }}
                onClick={close}
                className="category-menu-title"
              >
                {t(category)}{" "}
                <span>
                  {demoProducts.filter((p) => p.category === category).length}
                </span>
              </Link>
              {subcategories
                .filter(
                  (s) =>
                    s.category === category &&
                    demoProducts.some((p) => s.skus.includes(p.sku)),
                )
                .map((sub) => (
                  <Link
                    key={sub.id}
                    href={{
                      pathname: "/catalog",
                      query: { category, subcategory: sub.id },
                    }}
                    onClick={close}
                  >
                    {t(sub.name)} <span>↗</span>
                  </Link>
                ))}
            </section>
          ))}
        </div>
        <div className="category-menu-footer">
          <Link href="/promotions" onClick={close}>
            {en ? "Current demo offers" : "Текущи демо предложения"} ↗
          </Link>
          <Link href="/garage" onClick={close}>
            {en ? "Choose your vehicle" : "Избери своя автомобил"} ↗
          </Link>
        </div>
      </div>
    </details>
  );
}
