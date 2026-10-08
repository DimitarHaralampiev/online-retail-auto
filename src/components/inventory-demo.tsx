"use client";

import { useState } from "react";
import { demoProducts } from "../lib/catalog";
import { applyMovement, availableStock, type MovementType } from "../lib/inventory";

const movementLabels: Record<MovementType, string> = {
  receipt: "Доставка", reserve: "Резервиране", release: "Освобождаване", sale: "Продажба", return: "Връщане",
};

export default function InventoryDemo() {
  const [products, setProducts] = useState(demoProducts);
  const [sku, setSku] = useState(demoProducts[0].sku);
  const [type, setType] = useState<MovementType>("receipt");
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const product = products.find((item) => item.sku === sku);
      if (!product) throw new Error("Избери продукт.");
      const stock = applyMovement(product.stock, type, Number(quantity));
      setProducts(products.map((item) => item.sku === sku ? { ...item, stock } : item));
      const entry = `${movementLabels[type]} · ${product.name} · ${quantity} бр.`;
      setHistory([entry, ...history]);
      setMessage("Движението е приложено в демонстрацията.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Неуспешно движение.");
    }
  }

  return (
    <section className="categories" aria-label="Демонстрация на склад">
      <div className="table-wrapper"><table><caption>Примерни складови количества</caption><thead><tr><th scope="col">Продукт</th><th scope="col">В склада</th><th scope="col">Резервирани</th><th scope="col">Свободни</th></tr></thead><tbody>{products.map((product) => <tr key={product.sku}><th scope="row">{product.name}<small>{product.sku}</small></th><td>{product.stock.onHand}</td><td>{product.stock.reserved}</td><td>{availableStock(product.stock)}</td></tr>)}</tbody></table></div>
      <h2>Добави примерна операция</h2>
      <p className="note">Продажбата намалява предварително резервирани бройки. Освобождаването отменя резервация.</p>
      <form className="filters" onSubmit={submit}>
        <label>Продукт<select aria-label="Продукт" value={sku} onChange={(event) => setSku(event.target.value)}>{products.map((product) => <option value={product.sku} key={product.sku}>{product.name}</option>)}</select></label>
        <label>Движение<select aria-label="Движение" value={type} onChange={(event) => setType(event.target.value as MovementType)}>{Object.entries(movementLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Бройки<input type="number" min="1" step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <button className="button" type="submit">Приложи</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <p role="status">{message}</p>
      <h2>Движения в тази сесия</h2>
      {history.length ? <ol className="history">{history.map((entry, index) => <li key={index}>{entry}</li>)}</ol> : <p className="note">Все още няма добавени движения.</p>}
      <button className="reset-button" type="button" onClick={() => { setProducts(demoProducts); setHistory([]); setError(""); setMessage("Примерните данни са възстановени."); }}>Възстанови примерните данни</button>
    </section>
  );
}
