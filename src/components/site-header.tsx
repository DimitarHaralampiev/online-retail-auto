"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Icon from "./icon";

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
          <Link
            className="header-search"
            href="/catalog#catalog-search"
            aria-label="Търси продукт"
          >
            <Icon name="search" />
          </Link>
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
        </div>
      </header>
    </>
  );
}
