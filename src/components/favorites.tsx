"use client";
import Link from "next/link";
import { useCustomerFeatures } from "./customer-provider";
import { useAccount } from "./account-provider";
import { demoProducts } from "../lib/catalog";
import ProductCard from "./product-card";
export default function Favorites() {
  const { data, ready, busy, error, mutate } = useCustomerFeatures();
  const { customer } = useAccount();
  const products = demoProducts.filter((p) => data.favorites.includes(p.sku));
  const watched = data.alerts.filter((a) => a.active);
  return (
    <>
      {!customer && (
        <p className="demo-notice">
          Любимите се пазят в този браузър.{" "}
          <Link href="/account">Влез или се регистрирай</Link>, за да ги
          прехвърлим в профила ти и да избираш известия.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!ready ? (
        <p role="status">Зареждаме любимите…</p>
      ) : (
        <>
          <p className="note">Запазени продукти: {products.length}</p>
          <div className="product-grid">
            {products.map((p) => (
              <ProductCard product={p} key={p.sku} />
            ))}
          </div>
          {!products.length && (
            <div className="empty-cart">
              <h2>Запази нещо за следващия път.</h2>
              <Link className="button" href="/catalog">
                Разгледай каталога
              </Link>
            </div>
          )}
          {customer && (
            <section className="watchlist-panel">
              <h2>Продукти, които следиш</h2>
              <p className="note">
                За имейлите важи и изборът ти в{" "}
                <Link href="/account#services">„Моите услуги“</Link>.
              </p>
              {watched.map((a) => (
                <div key={a.sku + a.kind} className="watchlist-row">
                  <span>
                    {demoProducts.find((p) => p.sku === a.sku)?.name ?? a.sku} ·{" "}
                    {a.kind === "stock" ? "При наличност" : "При намаление"}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      mutate({
                        action: "alert",
                        sku: a.sku,
                        kind: a.kind,
                        enabled: false,
                      }).catch(() => {})
                    }
                  >
                    Спри известията
                  </button>
                </div>
              ))}
              {!watched.length && (
                <p>
                  Още не следиш продукти. Избирай известия от техните карти.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
