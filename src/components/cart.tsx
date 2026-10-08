"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart } from "./cart-provider";
import { demoProducts } from "../lib/catalog";
import { availableStock } from "../lib/inventory";
import { cartSubtotal, formatMoney } from "../lib/cart";
import Icon from "./icon";

export default function Cart() {
  const { items, ready, storageWarning, setQuantity, remove } = useCart();
  if (!ready) return <p role="status">Зареждаме количката…</p>;
  if (!items.length)
    return (
      <div className="empty-cart">
        <Icon name="cart" />
        <h2>Началото на следващото пътуване.</h2>
        <p>Количката ти е празна. Разгледай примерните продукти.</p>
        <Link className="button" href="/catalog">
          Към каталога <Icon name="arrow" />
        </Link>
      </div>
    );
  return (
    <>
      {storageWarning && <p className="demo-notice">{storageWarning}</p>}
      <div className="checkout-grid">
        <section className="cart-lines" aria-label="Продукти в количката">
          {items.map((item) => {
            const product = demoProducts.find(
              (entry) => entry.sku === item.sku,
            )!;
            return (
              <article className="cart-line" key={item.sku}>
                <Link href={`/catalog/${item.sku}`} className="cart-photo">
                  <Image
                    src={product.image}
                    alt={product.name}
                    fill
                    sizes="100px"
                  />
                </Link>
                <div>
                  <span className="product-category">{product.category}</span>
                  <h2>
                    <Link href={`/catalog/${item.sku}`}>{product.name}</Link>
                  </h2>
                  <p>Примерна цена: {formatMoney(product.demoPriceCents)}</p>
                  <button
                    className="remove-item"
                    type="button"
                    onClick={() => remove(item.sku)}
                    aria-label={`Премахни ${product.name}`}
                  >
                    Премахни
                  </button>
                </div>
                <div className="cart-quantity">
                  <label>
                    Бройки за {product.name}
                    <select
                      aria-label={`Бройки за ${product.name}`}
                      value={item.quantity}
                      onChange={(event) =>
                        setQuantity(item.sku, Number(event.target.value))
                      }
                    >
                      {Array.from(
                        { length: Math.min(availableStock(product.stock), 50) },
                        (_, index) => (
                          <option key={index + 1}>{index + 1}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <strong>
                    {formatMoney(product.demoPriceCents * item.quantity)}
                  </strong>
                </div>
              </article>
            );
          })}
        </section>
        <aside className="order-summary" aria-label="Обобщение на количката">
          <p className="eyebrow">ТВОЯТ ИЗБОР</p>
          <h2>Обобщение</h2>
          <dl>
            <div>
              <dt>Продукти · демо цени</dt>
              <dd>{formatMoney(cartSubtotal(items))}</dd>
            </div>
            <div>
              <dt>Доставка</dt>
              <dd>Предстои изчисляване</dd>
            </div>
          </dl>
          <p className="note">
            Доставката и окончателната сума ще бъдат определени след свързване с
            куриер.
          </p>
          <Link className="button" href="/checkout">
            Избери доставка <Icon name="arrow" />
          </Link>
        </aside>
      </div>
    </>
  );
}
