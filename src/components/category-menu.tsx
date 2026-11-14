"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useCatalog } from "./catalog-provider";
import { useLocale } from "./locale-provider";
export default function CategoryMenu() {
  const { t, locale } = useLocale();
  const { taxonomy } = useCatalog();
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
          {taxonomy.map(
            ({ id, name: category, productCount, subcategories }) => (
              <section key={id}>
                <Link
                  href={{ pathname: "/catalog", query: { category: id } }}
                  onClick={close}
                  className="category-menu-title"
                >
                  {t(category)} <span>{productCount}</span>
                </Link>
                {subcategories.map((sub) => (
                  <Link
                    key={sub.id}
                    href={{
                      pathname: "/catalog",
                      query: { category: id, subcategory: sub.id },
                    }}
                    onClick={close}
                  >
                    {t(sub.name)} <span>↗</span>
                  </Link>
                ))}
              </section>
            ),
          )}
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
