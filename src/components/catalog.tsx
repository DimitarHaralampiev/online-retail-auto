"use client";
import Link from "next/link";
import { useState } from "react";
import { useLocale } from "./locale-provider";
import { useCustomerFeatures } from "./customer-provider";
import { categories, demoProducts } from "../lib/catalog";
import { browseProducts, subcategories } from "../lib/catalog-browse";
import ProductCard from "./product-card";
export default function Catalog({
  initialCategory = "",
  initialQuery = "",
  initialSubcategory = "",
}: {
  initialCategory?: string;
  initialQuery?: string;
  initialSubcategory?: string;
}) {
  const { t, locale } = useLocale();
  const en = locale === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const initialSub = subcategories.find(
    (s) =>
      s.id === initialSubcategory &&
      (!initialCategory || s.category === initialCategory),
  );
  const [category, setCategory] = useState(
    categories.some((c) => c === initialCategory)
      ? initialCategory
      : initialSub?.category || "",
  );
  const [subcategory, setSubcategory] = useState(initialSub?.id || "");
  const [query, setQuery] = useState(initialQuery);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [onlyPromotions, setOnlyPromotions] = useState(false);
  const [onlyForCar, setOnlyForCar] = useState(false);
  const [sort, setSort] = useState("featured");
  const [view, setView] = useState("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { data, ready } = useCustomerFeatures();
  const selectedVehicle = data.vehicles.find((v) => v.selected);
  const carFilter = onlyForCar && !!selectedVehicle;
  const result = browseProducts(
    demoProducts,
    {
      category,
      subcategory,
      query,
      minPrice,
      maxPrice,
      available: onlyAvailable,
      promotions: onlyPromotions,
      compatibleSkus: carFilter ? data.compatibleSkus : undefined,
      sort,
    },
    t,
  );
  function reset() {
    setCategory("");
    setSubcategory("");
    setQuery("");
    setMinPrice("");
    setMaxPrice("");
    setOnlyAvailable(false);
    setOnlyPromotions(false);
    setOnlyForCar(false);
  }
  const activeCount = [
    category,
    subcategory,
    query.trim(),
    minPrice,
    maxPrice,
    onlyAvailable,
    onlyPromotions,
    carFilter,
  ].filter(Boolean).length;
  const selectedSub = subcategories.find((s) => s.id === subcategory);
  return (
    <>
      <nav
        className="breadcrumbs"
        aria-label={text("Път до категорията", "Category breadcrumb")}
      >
        <Link href="/">{t("Начало")}</Link>
        <span>/</span>
        <Link href="/catalog">{t("Каталог")}</Link>
        {category && (
          <>
            <span>/</span>
            <span>{t(category)}</span>
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
                value={query}
                maxLength={120}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={text(
                  "Име или продуктов код",
                  "Name or product code",
                )}
              />
            </label>
            <label>
              {t("Категория")}
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setSubcategory("");
                }}
              >
                <option value="">{t("Всички категории")}</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {t(c)} (
                    {demoProducts.filter((p) => p.category === c).length})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {text("Подкатегория", "Subcategory")}
              <select
                value={subcategory}
                onChange={(e) => {
                  setSubcategory(e.target.value);
                  const s = subcategories.find((s) => s.id === e.target.value);
                  if (s) setCategory(s.category);
                }}
              >
                <option value="">
                  {text("Всички подкатегории", "All subcategories")}
                </option>
                {subcategories
                  .filter((s) => !category || s.category === category)
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
                  onChange={(e) => setMinPrice(e.target.value)}
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
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="—"
                />
              </label>
            </fieldset>
            {result.invalidPrice && (
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
                  checked={onlyAvailable}
                  onChange={(e) => setOnlyAvailable(e.target.checked)}
                />
                {t("Само налични")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={onlyPromotions}
                  onChange={(e) => setOnlyPromotions(e.target.checked)}
                />
                {text("Само промоции", "Only promotions")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={carFilter}
                  disabled={!ready || !selectedVehicle}
                  onChange={(e) => setOnlyForCar(e.target.checked)}
                />
                {t("Само за моя автомобил")}
              </label>
            </div>
            <div className="catalog-vehicle-note">
              {selectedVehicle ? (
                <>
                  <strong>
                    {selectedVehicle.make} {selectedVehicle.model}
                  </strong>
                  <p>
                    {selectedVehicle.year} · {selectedVehicle.engine}
                  </p>
                </>
              ) : (
                <Link href="/garage">{t("Добави и избери автомобил →")}</Link>
              )}
              {carFilter && (
                <p>
                  {text(
                    "Показваме само проверена съвместимост.",
                    "Only verified compatibility is shown.",
                  )}
                </p>
              )}
            </div>
          </div>
        </aside>
        <div className="catalog-browse-results">
          <div className="catalog-results-toolbar">
            <p role="status">
              <strong>{result.products.length}</strong>{" "}
              {text("продукта", "products")}
            </p>
            <label>
              {text("Подреди", "Sort")}
              <select
                aria-label={text("Подреди", "Sort")}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
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
            <div
              className="catalog-view-switch"
              role="group"
              aria-label={text("Изглед", "View")}
            >
              <button
                type="button"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
                aria-label={text("Мрежа", "Grid")}
              >
                ▦
              </button>
              <button
                type="button"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
                aria-label={text("Списък", "List")}
              >
                ☷
              </button>
            </div>
          </div>
          {activeCount > 0 && (
            <div
              className="catalog-filter-chips"
              aria-label={text("Активни филтри", "Active filters")}
            >
              {category && (
                <button
                  onClick={() => {
                    setCategory("");
                    setSubcategory("");
                  }}
                >
                  {t(category)} ×
                </button>
              )}
              {selectedSub && (
                <button onClick={() => setSubcategory("")}>
                  {t(selectedSub.name)} ×
                </button>
              )}
              {query.trim() && (
                <button onClick={() => setQuery("")}>{query} ×</button>
              )}
              {(minPrice || maxPrice) && (
                <button
                  onClick={() => {
                    setMinPrice("");
                    setMaxPrice("");
                  }}
                >
                  {minPrice || "0"}–{maxPrice || "∞"} EUR ×
                </button>
              )}
              {onlyAvailable && (
                <button onClick={() => setOnlyAvailable(false)}>
                  {t("Само налични")} ×
                </button>
              )}
              {onlyPromotions && (
                <button onClick={() => setOnlyPromotions(false)}>
                  {text("Промоции", "Promotions")} ×
                </button>
              )}
              {carFilter && (
                <button onClick={() => setOnlyForCar(false)}>
                  {text("Моят автомобил", "My vehicle")} ×
                </button>
              )}
              <button className="catalog-clear-all" onClick={reset}>
                {text("Изчисти всички", "Clear all")}
              </button>
            </div>
          )}
          <div
            className={`product-grid ${view === "list" ? "catalog-list-view" : ""}`}
          >
            {result.products.map((product) => (
              <ProductCard key={product.sku} product={product} />
            ))}
          </div>
          {!result.products.length && !result.invalidPrice && (
            <div className="catalog-empty-state">
              <h2>
                {text("Не открихме съвпадение.", "No matching products.")}
              </h2>
              <p>
                {text(
                  "Промени филтрите или разгледай всички продукти.",
                  "Change the filters or explore all products.",
                )}
              </p>
              <button className="button" onClick={reset}>
                {text("Покажи всички продукти", "Show all products")}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
