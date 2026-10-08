"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Icon from "./icon";
import { useCart } from "./cart-provider";
import { categories, demoProducts } from "../lib/catalog";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="AUTO/SHOP — Начална страница">
      <svg className="brand-mark" viewBox="0 0 38 38" aria-hidden="true">
        <path
          d="M3 32 17 6h8L11 32H3Zm17 0 7-13 8 13H20Z"
          fill="currentColor"
        />
      </svg>
      <span className="brand-name">
        AUTO<span className="brand-slash">/</span>SHOP
        <small>PARTS. CARE. CHARACTER.</small>
      </span>
    </Link>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { items } = useCart();
  const cartCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const navigation = [
    { href: "/", label: "Начало", active: pathname === "/" },
    {
      href: "/catalog",
      label: "Каталог",
      active: pathname.startsWith("/catalog"),
    },
    { href: "/#approach", label: "Нашият подход", active: false },
    {
      href: "/inventory-demo",
      label: "Демо склад",
      active: pathname === "/inventory-demo",
    },
  ];
  return (
    <>
      <a className="skip-link" href="#main-content">
        Към съдържанието
      </a>
      <div className="topbar">
        <div className="site-width">
          <span>
            АВТОЧАСТИ И АКСЕСОАРИ <span className="topbar-divider">/</span>{" "}
            БЪЛГАРИЯ
          </span>
          <span className="opening-status">
            <i /> ПРЕДСТОИ ОТКРИВАНЕ
          </span>
        </div>
      </div>
      <header className="site-header">
        <div className="site-width header-inner">
          <Brand />
          <nav
            className={`site-nav ${open ? "is-open" : ""}`}
            id="site-navigation"
            aria-label="Основна навигация"
          >
            {navigation.map(({ href, label, active }) => (
              <Link
                key={href}
                href={href}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {label}
              </Link>
            ))}
          </nav>
          <button
            className="menu-toggle"
            type="button"
            aria-label={open ? "Затвори менюто" : "Отвори менюто"}
            aria-expanded={open}
            aria-controls="site-navigation"
            onClick={() => setOpen(!open)}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
          <Link
            className="header-cart"
            href="/cart"
            aria-label={`Количка: ${cartCount} броя`}
          >
            <Icon name="cart" />
            <span>{cartCount}</span>
          </Link>
        </div>
      </header>
      <div className="shop-toolbar">
        <div className="site-width shop-toolbar-inner">
          <nav className="quick-categories" aria-label="Продуктови категории">
            {categories
              .filter((category) =>
                demoProducts.some((product) => product.category === category),
              )
              .map((category) => (
                <Link
                  key={category}
                  href={{ pathname: "/catalog", query: { category } }}
                >
                  {category === "Части и консумативи"
                    ? "Части"
                    : category === "Автоаксесоари"
                      ? "Аксесоари"
                      : category}
                  <span>
                    {
                      demoProducts.filter(
                        (product) => product.category === category,
                      ).length
                    }
                  </span>
                </Link>
              ))}
          </nav>
          <form
            className="shop-search"
            action="/catalog"
            method="get"
            role="search"
            aria-label="Търсене в магазина"
          >
            <input
              type="search"
              name="q"
              maxLength={120}
              aria-label="Търсене в магазина"
              placeholder="Потърси продукт или код…"
            />
            <button type="submit" aria-label="Търси в каталога">
              <Icon name="search" />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
