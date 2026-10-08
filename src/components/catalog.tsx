"use client";

import { useState } from "react";
import { categories, demoProducts } from "../lib/catalog";
import { availableStock } from "../lib/inventory";
import ProductCard from "./product-card";
import Icon from "./icon";

export default function Catalog({
  initialCategory = "",
  initialQuery = "",
}: {
  initialCategory?: string;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState<string>(
    categories.some((item) => item === initialCategory) ? initialCategory : "",
  );
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase("bg");
  const products = demoProducts.filter(
    (product) =>
      (!category || product.category === category) &&
      (!onlyAvailable || availableStock(product.stock) > 0) &&
      `${product.name} ${product.sku}`
        .toLocaleLowerCase("bg")
        .includes(normalizedQuery),
  );

  return (
    <>
      <div className="filters catalog-filters" id="catalog-search">
        <label>
          Търсене
          <span className="search-field">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Име или продуктов код"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
        </label>
        <label>
          Категория
          <select
            aria-label="Категория"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Всички категории</option>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(event) => setOnlyAvailable(event.target.checked)}
          />{" "}
          Само налични
        </label>
      </div>
      <div className="catalog-results">
        <p role="status">
          Намерени продукти: <strong>{products.length}</strong>
        </p>
        <span>ДЕМО КОЛЕКЦИЯ / 01</span>
      </div>
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard product={product} key={product.sku} />
        ))}
      </div>
      {products.length === 0 && (
        <p className="empty">Няма резултати. Промени търсенето или филтрите.</p>
      )}
    </>
  );
}
