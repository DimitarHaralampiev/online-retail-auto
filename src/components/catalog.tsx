"use client";

import Link from "next/link";
import { useState } from "react";
import { categories, demoProducts } from "../lib/catalog";
import { availableStock } from "../lib/inventory";

export default function Catalog() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase("bg");
  const products = demoProducts.filter((product) =>
    (!category || product.category === category) &&
    (!onlyAvailable || availableStock(product.stock) > 0) &&
    `${product.name} ${product.sku}`.toLocaleLowerCase("bg").includes(normalizedQuery),
  );

  return (
    <>
      <div className="filters">
        <label>Търсене<input type="search" placeholder="Име или продуктов код" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>Категория<select aria-label="Категория" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Всички категории</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="checkbox"><input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} /> Само налични</label>
      </div>
      <p className="note" role="status">Намерени продукти: {products.length}</p>
      <div className="grid">
        {products.map((product) => (
          <article className="card" key={product.sku}>
            <span className="number">{product.sku} · {product.category}</span>
            <h2 className="product-title"><Link href={`/catalog/${product.sku}`}>{product.name}</Link></h2>
            <p>{product.description}</p>
            <span className={availableStock(product.stock) > 0 ? "stock-available" : "note"}>{availableStock(product.stock) > 0 ? "Примерна наличност" : "Няма свободни бройки"}</span>
          </article>
        ))}
      </div>
      {products.length === 0 && <p className="empty">Няма резултати. Промени търсенето или филтрите.</p>}
    </>
  );
}
