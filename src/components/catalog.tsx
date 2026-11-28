"use client";
// Catalog filters and results. The URL is the source of truth: the server
// page parses it, runs catalog().browse() and passes one page of results.
// Controls here only change the URL (selects and checkboxes immediately,
// typed text and prices after a short pause).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  MAX_BROWSE_TEXT,
  type AttributeFacet,
  type BrandFacet,
  type BrowsePage,
} from "../lib/catalog";
import { attributeText, toggleAttribute } from "../lib/attributes";
import {
  catalogHref,
  EMPTY_CATALOG_STATE,
  parseCatalogSearch,
  priceRange,
  type CatalogUrlState,
} from "../lib/catalog-url";
import { useCatalog } from "./catalog-provider";
import {
  CatalogViewFrame,
  CatalogViewProvider,
  CatalogViewSwitch,
} from "./catalog-view";
import { useLocale } from "./locale-provider";
import ProductCard from "./product-card";
import type { FitStatus } from "../lib/vehicles";

const TYPING_DELAY_MS = 300;

export default function Catalog({
  state,
  result,
  carFilter,
  vehicle,
  fit = {},
  brands = [],
  attributes = [],
}: {
  state: CatalogUrlState;
  /** Null when the URL's price range is invalid. */
  result: BrowsePage | null;
  /** Whether the vehicle filter was applied by the server. */
  carFilter: boolean;
  /**
   * The car chosen in the vehicle selector; undefined when the catalog has
   * no vehicle reference (static demo), label null when none is chosen.
   */
  vehicle?: { label: string | null };
  /** Fit status per SKU for the chosen car (ADR 0002). */
  fit?: Record<string, FitStatus>;
  /** Brand facet with counts under the other filters. */
  brands?: BrandFacet[];
  /** Attribute facets with counts under the other filters (#103). */
  attributes?: AttributeFacet[];
}) {
  const { t, locale } = useLocale();
  const en = locale === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { taxonomy } = useCatalog();
  const subcategories = taxonomy.flatMap((c) =>
    c.subcategories.map((s) => ({ ...s, category: c.id })),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Typed inputs keep local values while the visitor types.
  const [q, setQ] = useState(state.q);
  const [minPrice, setMinPrice] = useState(state.min);
  const [maxPrice, setMaxPrice] = useState(state.max);

  // `intended` is the state the visitor asked for, including typed text and
  // valid prices not yet sent. Every navigation is built from it, so a filter
  // chosen right after typing keeps the typed text, and a delayed navigation
  // never resurrects an older state. The ref mirrors it for timers.
  const [intended, setIntended] = useState(state);
  const intendedRef = useRef(state);
  const [typing, setTyping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // When the server applied something else than asked for (a link, or a
  // filter it dropped), adopt it. While the visitor is typing or a navigation
  // is running, answers may be intermediate ones: decide once that settles.
  const stateHref = catalogHref(state, { page: state.page });
  const [seenHref, setSeenHref] = useState(stateHref);
  if (seenHref !== stateHref && !typing && !pending) {
    setSeenHref(stateHref);
    if (stateHref !== catalogHref(intended, { page: intended.page })) {
      setIntended(state);
      setQ(state.q);
      setMinPrice(state.min);
      setMaxPrice(state.max);
    }
  }
  useEffect(() => {
    intendedRef.current = intended;
  }, [intended]);
  // Back/Forward wins over typing not sent yet: drop its timer (it would
  // replace the entry just returned to) and adopt that entry's URL at once.
  useEffect(() => {
    function onPopState() {
      clearTimeout(timer.current);
      setTyping(false);
      if (location.pathname !== "/catalog") return;
      const next = parseCatalogSearch(location.search);
      intendedRef.current = next;
      setIntended(next);
      setQ(next.q);
      setMinPrice(next.min);
      setMaxPrice(next.max);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  // Leaving the page must not fire a pending typed navigation.
  useEffect(() => () => clearTimeout(timer.current), []);

  function go(next: CatalogUrlState, replace: boolean) {
    clearTimeout(timer.current);
    setTyping(false);
    intendedRef.current = next;
    setIntended(next);
    const href = catalogHref(next, { page: next.page });
    startTransition(() =>
      replace
        ? router.replace(href, { scroll: false })
        : router.push(href, { scroll: false }),
    );
  }
  // Discrete choices become history entries (Back undoes them). Any filter
  // change returns to the first page.
  function navigate(changes: Partial<CatalogUrlState>) {
    go({ ...intendedRef.current, page: 1, ...changes }, false);
  }
  // Typing replaces the current entry after a pause, so each keystroke is
  // not a history step.
  function navigateSoon(changes: Partial<CatalogUrlState>) {
    const next = { ...intendedRef.current, page: 1, ...changes };
    intendedRef.current = next;
    setIntended(next);
    setTyping(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => go(intendedRef.current, true),
      TYPING_DELAY_MS,
    );
  }
  function changePrice(min: string, max: string) {
    setMinPrice(min);
    setMaxPrice(max);
    // An invalid range is shown but not sent; other pending changes stay.
    if (priceRange({ min: min.trim(), max: max.trim() }).valid)
      navigateSoon({ min: min.trim(), max: max.trim() });
  }
  function reset() {
    setQ("");
    setMinPrice("");
    setMaxPrice("");
    go({ ...EMPTY_CATALOG_STATE }, false);
  }

  const invalidPrice =
    !result ||
    !priceRange({ min: minPrice.trim(), max: maxPrice.trim() }).valid;
  const selectedSub = subcategories.find((s) => s.id === state.subcategory);
  const selectedCategory = taxonomy.find((c) => c.id === state.category);
  const activeCount =
    [
      state.category,
      state.subcategory,
      state.q,
      state.min,
      state.max,
      state.available,
      state.promotions,
      carFilter,
    ].filter(Boolean).length +
    state.brands.length +
    Object.values(state.attributes).flat().length;
  const brandName = (key: string) =>
    brands.find((b) => b.key === key)?.name ?? key;
  // From the intended brands, so quick clicks all count.
  function toggleBrand(key: string, on: boolean) {
    const chosen = intendedRef.current.brands.filter((brand) => brand !== key);
    navigate({ brands: on ? [...chosen, key] : chosen });
  }
  const setAttribute = (key: string, valueKey: string, on: boolean) =>
    navigate({
      attributes: toggleAttribute(
        intendedRef.current.attributes,
        key,
        valueKey,
        on,
      ),
    });
  // "Вискозитет: 5W-30"; the raw key and value when the facet lacks them.
  const attributeLabel = (key: string, valueKey: string) => {
    const facet = attributes.find((a) => a.key === key);
    const value = facet?.values.find((v) => v.key === valueKey)?.value;
    return `${facet?.name ?? key}: ${attributeText(value ?? valueKey, facet?.unit ?? "")}`;
  };
  const products = result?.items ?? [];

  return (
    <CatalogViewProvider>
      <nav
        className="breadcrumbs"
        aria-label={text("Път до категорията", "Category breadcrumb")}
      >
        <Link href="/">{t("Начало")}</Link>
        <span>/</span>
        <Link href="/catalog">{t("Каталог")}</Link>
        {state.category && (
          <>
            <span>/</span>
            <span>{t(selectedCategory?.name ?? state.category)}</span>
          </>
        )}
        {selectedSub && (
          <>
            <span>/</span>
            <span>{t(selectedSub.name)}</span>
          </>
        )}
      </nav>
      <div className="catalog-browse-layout">
        <aside className="catalog-sidebar">
          <button
            type="button"
            className="catalog-filter-toggle"
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
            aria-controls="catalog-filter-fields"
          >
            {text("Филтри", "Filters")} {activeCount > 0 && `(${activeCount})`}{" "}
            <span aria-hidden="true">⌄</span>
          </button>
          <div
            id="catalog-filter-fields"
            className={
              filtersOpen
                ? "catalog-filter-fields is-open"
                : "catalog-filter-fields"
            }
          >
            <div className="catalog-sidebar-title">
              <h2>{text("Намери своя продукт", "Find your product")}</h2>
              {activeCount > 0 && (
                <button type="button" onClick={reset}>
                  {text("Изчисти", "Clear")}
                </button>
              )}
            </div>
            <label>
              {t("Търсене")}
              <input
                type="search"
                value={q}
                maxLength={MAX_BROWSE_TEXT}
                onChange={(e) => {
                  setQ(e.target.value);
                  navigateSoon({ q: e.target.value.trim() });
                }}
                placeholder={text(
                  "Име или продуктов код",
                  "Name or product code",
                )}
              />
            </label>
            <label>
              {t("Категория")}
              <select
                value={intended.category}
                onChange={(e) =>
                  navigate({ category: e.target.value, subcategory: "" })
                }
              >
                <option value="">{t("Всички категории")}</option>
                {taxonomy.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.name)} ({c.productCount})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {text("Подкатегория", "Subcategory")}
              <select
                value={
                  subcategories.some((s) => s.id === intended.subcategory)
                    ? intended.subcategory
                    : ""
                }
                onChange={(e) => {
                  const sub = subcategories.find(
                    (s) => s.id === e.target.value,
                  );
                  navigate({
                    subcategory: e.target.value,
                    ...(sub ? { category: sub.category } : {}),
                  });
                }}
              >
                <option value="">
                  {text("Всички подкатегории", "All subcategories")}
                </option>
                {subcategories
                  .filter(
                    (s) =>
                      !intended.category || s.category === intended.category,
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {t(s.name)}
                    </option>
                  ))}
              </select>
            </label>
            <fieldset className="catalog-price-filter">
              <legend>{text("Цена (EUR)", "Price (EUR)")}</legend>
              <label>
                {text("От", "From")}
                <input
                  type="text"
                  inputMode="decimal"
                  value={minPrice}
                  maxLength={12}
                  onChange={(e) => changePrice(e.target.value, maxPrice)}
                  placeholder="0"
                />
              </label>
              <label>
                {text("До", "To")}
                <input
                  type="text"
                  inputMode="decimal"
                  value={maxPrice}
                  maxLength={12}
                  onChange={(e) => changePrice(minPrice, e.target.value)}
                  placeholder="—"
                />
              </label>
            </fieldset>
            {invalidPrice && (
              <p className="error" role="alert">
                {text(
                  "Въведи валиден диапазон с до 2 знака след запетаята.",
                  "Enter a valid range with up to 2 decimal places.",
                )}
              </p>
            )}
            <div className="catalog-check-filters">
              <label>
                <input
                  type="checkbox"
                  checked={intended.available}
                  onChange={(e) => navigate({ available: e.target.checked })}
                />
                {t("Само налични")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={intended.promotions}
                  onChange={(e) => navigate({ promotions: e.target.checked })}
                />
                {text("Само промоции", "Only promotions")}
              </label>
              {vehicle && (
                <label>
                  <input
                    type="checkbox"
                    checked={intended.car && !!vehicle.label}
                    disabled={!vehicle.label}
                    onChange={(e) => navigate({ car: e.target.checked })}
                  />
                  {t("Само за моя автомобил")}
                </label>
              )}
            </div>
            {brands.length > 0 && (
              <fieldset className="catalog-brand-filter">
                <legend>{text("Марка", "Brand")}</legend>
                {brands.map((brand) => (
                  <label key={brand.key}>
                    <input
                      type="checkbox"
                      checked={intended.brands.includes(brand.key)}
                      onChange={(e) => toggleBrand(brand.key, e.target.checked)}
                    />
                    {brand.name}{" "}
                    <span className="catalog-facet-count">({brand.count})</span>
                  </label>
                ))}
              </fieldset>
            )}
            {attributes
              .filter((attribute) => attribute.values.length > 0)
              .map((attribute) => (
                <fieldset key={attribute.key} className="catalog-brand-filter">
                  <legend>{attribute.name}</legend>
                  {attribute.values.map((value) => (
                    <label key={value.key}>
                      <input
                        type="checkbox"
                        checked={
                          intended.attributes[attribute.key]?.includes(
                            value.key,
                          ) ?? false
                        }
                        onChange={(e) =>
                          setAttribute(
                            attribute.key,
                            value.key,
                            e.target.checked,
                          )
                        }
                      />
                      {attributeText(value.value, attribute.unit)}{" "}
                      <span className="catalog-facet-count">
                        ({value.count})
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            {vehicle && (
              <div className="catalog-vehicle-note">
                {vehicle.label ? (
                  <strong>{vehicle.label}</strong>
                ) : (
                  <p>
                    {text(
                      "Избери автомобила си от „Моят автомобил“ отгоре.",
                      "Choose your car in “My car” above.",
                    )}
                  </p>
                )}
                {carFilter && (
                  <p>
                    {text(
                      "Показваме само проверена съвместимост и универсални продукти.",
                      "Only verified compatibility and universal products are shown.",
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>
        <div className="catalog-browse-results" aria-busy={pending}>
          <div className="catalog-results-toolbar">
            <p role="status">
              <strong>{result?.total ?? 0}</strong>{" "}
              {text("продукта", "products")}
            </p>
            <label>
              {text("Подреди", "Sort")}
              <select
                aria-label={text("Подреди", "Sort")}
                value={intended.sort}
                onChange={(e) =>
                  navigate({ sort: e.target.value as CatalogUrlState["sort"] })
                }
              >
                <option value="featured">{text("Подбрани", "Featured")}</option>
                <option value="price-asc">
                  {text("Цена: ниска → висока", "Price: low → high")}
                </option>
                <option value="price-desc">
                  {text("Цена: висока → ниска", "Price: high → low")}
                </option>
                <option value="name">
                  {text("Име: А → Я", "Name: A → Z")}
                </option>
              </select>
            </label>
            <CatalogViewSwitch />
          </div>
          {activeCount > 0 && (
            <div
              className="catalog-filter-chips"
              aria-label={text("Активни филтри", "Active filters")}
            >
              {state.category && (
                <button
                  onClick={() => navigate({ category: "", subcategory: "" })}
                >
                  {t(selectedCategory?.name ?? state.category)} ×
                </button>
              )}
              {selectedSub && (
                <button onClick={() => navigate({ subcategory: "" })}>
                  {t(selectedSub.name)} ×
                </button>
              )}
              {state.q && (
                <button onClick={() => navigate({ q: "" })}>{state.q} ×</button>
              )}
              {(state.min || state.max) && (
                <button onClick={() => navigate({ min: "", max: "" })}>
                  {state.min || "0"}–{state.max || "∞"} EUR ×
                </button>
              )}
              {state.available && (
                <button onClick={() => navigate({ available: false })}>
                  {t("Само налични")} ×
                </button>
              )}
              {state.promotions && (
                <button onClick={() => navigate({ promotions: false })}>
                  {text("Промоции", "Promotions")} ×
                </button>
              )}
              {carFilter && (
                <button onClick={() => navigate({ car: false })}>
                  {text("Моят автомобил", "My vehicle")} ×
                </button>
              )}
              {state.brands.map((key) => (
                <button
                  key={key}
                  onClick={() => toggleBrand(key, false)}
                  aria-label={
                    text("Премахни марка ", "Remove brand ") + brandName(key)
                  }
                >
                  {brandName(key)} ×
                </button>
              ))}
              {Object.entries(state.attributes).flatMap(([key, values]) =>
                values.map((value) => (
                  <button
                    key={`${key}:${value}`}
                    onClick={() => setAttribute(key, value, false)}
                  >
                    {attributeLabel(key, value)} ×
                  </button>
                )),
              )}
              <button className="catalog-clear-all" onClick={reset}>
                {text("Изчисти всички", "Clear all")}
              </button>
            </div>
          )}
          <CatalogViewFrame>
            {products.map((product) => (
              <ProductCard
                key={product.sku}
                product={product}
                fit={fit[product.sku]}
              />
            ))}
          </CatalogViewFrame>
          {result && result.pageCount > 1 && products.length > 0 && (
            <nav
              className="catalog-pagination"
              aria-label={text("Страници", "Pages")}
            >
              {result.page > 1 && (
                <Link
                  rel="prev"
                  href={catalogHref(state, {
                    page: Math.min(result.page - 1, result.pageCount),
                  })}
                >
                  ← {text("Предишна", "Previous")}
                </Link>
              )}
              <span aria-current="page">
                {text(
                  `Страница ${result.page} от ${result.pageCount}`,
                  `Page ${result.page} of ${result.pageCount}`,
                )}
              </span>
              {result.page < result.pageCount && (
                <Link
                  rel="next"
                  href={catalogHref(state, { page: result.page + 1 })}
                >
                  {text("Следваща", "Next")} →
                </Link>
              )}
            </nav>
          )}
          {!result && (
            <div className="catalog-empty-state">
              <h2>
                {text(
                  "Ценовият диапазон е невалиден.",
                  "The price range is invalid.",
                )}
              </h2>
              <p>
                {text(
                  "Провери цените във филтрите или изчисти ги.",
                  "Check the prices in the filters or clear them.",
                )}
              </p>
              <button
                className="button"
                onClick={() => navigate({ min: "", max: "" })}
              >
                {text("Изчисти цената", "Clear the price")}
              </button>
            </div>
          )}
          {result && !products.length && (
            <div className="catalog-empty-state">
              <h2>
                {result.total > 0
                  ? text("Няма такава страница.", "There is no such page.")
                  : text("Не открихме съвпадение.", "No matching products.")}
              </h2>
              <p>
                {text(
                  "Промени филтрите или разгледай всички продукти.",
                  "Change the filters or explore all products.",
                )}
              </p>
              {result.total > 0 ? (
                <Link className="button" href={catalogHref(state, { page: 1 })}>
                  {text("Към първата страница", "Go to the first page")}
                </Link>
              ) : (
                <button className="button" onClick={reset}>
                  {text("Покажи всички продукти", "Show all products")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </CatalogViewProvider>
  );
}
