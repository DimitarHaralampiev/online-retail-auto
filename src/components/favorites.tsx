"use client";
import Localize from "./localize";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCustomerFeatures } from "./customer-provider";
import { useAccount } from "./account-provider";
import { useCatalog } from "./catalog-provider";
import ProductCard from "./product-card";
export default function Favorites() {
  const { data, ready, busy, error, mutate } = useCustomerFeatures();
  const { customer } = useAccount();
  const { productBySku, ensureProducts } = useCatalog();
  const watched = data.alerts.filter((a) => a.active);
  // Load only the products this page shows.
  const wanted = [...data.favorites, ...watched.map((a) => a.sku)].join("\n");
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    if (!wanted) return;
    ensureProducts(wanted.split("\n")).then(
      () => setFailed(false),
      () => setFailed(true),
    );
  }, [wanted, ensureProducts]);
  useEffect(load, [load]);
  const products = data.favorites.flatMap((sku) => {
    const product = productBySku(sku);
    return product ? [product] : [];
  });
  return (
    <Localize>
      {
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
              {failed && (
                <p className="demo-notice" role="status">
                  Някои продукти не се заредиха.{" "}
                  <button type="button" className="text-button" onClick={load}>
                    Опитай отново
                  </button>
                </p>
              )}
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
                        {productBySku(a.sku)?.name ?? a.sku} ·{" "}
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
      }
    </Localize>
  );
}
