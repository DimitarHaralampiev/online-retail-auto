"use client";
// Header search with suggestions (#37), following the WAI-ARIA combobox
// pattern: the input keeps focus, arrows move through categories, products
// and "show all results", Enter opens the highlighted entry (or searches the
// catalog), Escape closes. Requests are debounced and stale ones aborted.
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./icon";
import { useLocale } from "./locale-provider";
import { MIN_SUGGEST_CHARS, type SuggestResponse } from "../lib/search";

const DEBOUNCE_MS = 200;

type Option = {
  href: string;
  kind: "category" | "product" | "all";
  label: string;
  detail?: string;
};

export default function SearchAutocomplete() {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SuggestResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_SUGGEST_CHARS) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search/suggest?${new URLSearchParams({ q, locale })}`, {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: SuggestResponse | null) => {
          if (!data) return;
          setResults(data);
          setActive(-1);
          setOpen(true);
        })
        // Aborted or offline: the form still searches the catalog on Enter.
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, locale]);

  const price = (cents: number) =>
    new Intl.NumberFormat(locale === "en" ? "en-GB" : "bg-BG", {
      style: "currency",
      currency: "EUR",
    }).format(cents / 100);

  const q = query.trim();
  const options: Option[] =
    results && q.length >= MIN_SUGGEST_CHARS
      ? [
          ...results.categories.map((c) => ({
            href: c.href,
            kind: "category" as const,
            label: c.name,
            detail: c.parent,
          })),
          ...results.products.map((p) => ({
            href: p.href,
            kind: "product" as const,
            label: p.name,
            detail: `${p.category} · ${price(p.salePriceCents ?? p.priceCents)}`,
          })),
          {
            href: `/catalog?${new URLSearchParams({ q })}`,
            kind: "all" as const,
            label: text(`Всички резултати за „${q}“`, `All results for “${q}”`),
          },
        ]
      : [];
  const expanded = open && options.length > 0;
  const optionId = (index: number) => `${id}-option-${index}`;

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function go(option: Option) {
    close();
    router.push(option.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      setActive((current) =>
        current < 0 && step < 0
          ? options.length - 1
          : (current + step + options.length) % options.length,
      );
    } else if (event.key === "Enter" && expanded && active >= 0) {
      event.preventDefault();
      go(options[active]);
    } else if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        close();
      } else setQuery("");
    } else if (expanded && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : options.length - 1);
    }
  }

  const groups: { kind: Option["kind"]; title?: string }[] = [
    { kind: "category", title: text("Категории", "Categories") },
    { kind: "product", title: text("Продукти", "Products") },
    { kind: "all" },
  ];

  return (
    <form
      className="shop-search"
      action="/catalog"
      method="get"
      role="search"
      aria-label={text("Търсене в магазина", "Search the shop")}
      onSubmit={close}
    >
      <input
        type="search"
        name="q"
        maxLength={120}
        role="combobox"
        aria-label={text("Търсене в магазина", "Search the shop")}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={
          expanded && active >= 0 ? optionId(active) : undefined
        }
        autoComplete="off"
        placeholder={text(
          "Потърси продукт или код…",
          "Search for a product or code…",
        )}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(-1);
          if (event.target.value.trim().length < MIN_SUGGEST_CHARS) {
            setResults(null);
            setOpen(false);
          }
        }}
        onKeyDown={onKeyDown}
        onFocus={() => results && setOpen(true)}
        onBlur={close}
      />
      <button
        type="submit"
        aria-label={text("Търси в каталога", "Search the catalog")}
      >
        <Icon name="search" />
      </button>
      <div
        id={`${id}-listbox`}
        role="listbox"
        aria-label={text("Предложения", "Suggestions")}
        className="search-suggestions"
        hidden={!expanded}
      >
        {groups.map((group) => {
          const items = options
            .map((option, index) => ({ option, index }))
            .filter(({ option }) => option.kind === group.kind);
          if (!items.length) return null;
          return (
            <div
              key={group.kind}
              role="group"
              aria-labelledby={group.title ? `${id}-${group.kind}` : undefined}
              aria-label={group.title ? undefined : text("Търсене", "Search")}
            >
              {group.title && (
                <div
                  id={`${id}-${group.kind}`}
                  className="search-suggestions-title"
                  role="presentation"
                >
                  {group.title}
                </div>
              )}
              {items.map(({ option, index }) => (
                <div
                  key={option.href}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  className={`search-suggestion search-suggestion-${option.kind}`}
                  // Keep focus in the input so the click is not lost to blur.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => go(option)}
                  onMouseEnter={() => setActive(index)}
                >
                  <span>{option.label}</span>
                  {option.detail && <small>{option.detail}</small>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {expanded
          ? text(
              `${options.length - 1} предложения. Използвай стрелките.`,
              `${options.length - 1} suggestions. Use the arrow keys.`,
            )
          : ""}
      </p>
    </form>
  );
}
