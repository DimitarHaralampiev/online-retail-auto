import Localize from "../../../components/localize";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { availableStock } from "../../../lib/inventory";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import Icon from "../../../components/icon";
import AddToCart from "../../../components/add-to-cart";
import ProductPrice from "../../../components/product-price";

import ProductActions from "../../../components/product-actions";
import ProductCard from "../../../components/product-card";
import { catalog, catalogSource } from "../../../lib/catalog-server";
import { database } from "../../../lib/accounts";
import { productFitInfo, type ProductFitment } from "../../../lib/vehicles";
import { requestLocale } from "../../../lib/i18n/server";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const locale = await requestLocale();
  const store = catalog(locale);
  const product = await store.getProduct(sku);
  if (!product) notFound();
  const subcategory = product.subcategory;
  const en = locale === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  // Verified fitment lives with the vehicle reference in PostgreSQL.
  const fitInfo =
    catalogSource() === "postgres"
      ? await productFitInfo(database(), sku).catch(() => null)
      : null;
  const years = (f: ProductFitment) => {
    const from = f.fitYearFrom ?? f.yearFrom;
    const to = f.fitYearTo ?? f.yearTo;
    return `${from}–${to ?? text("днес", "today")}`;
  };
  const related = (await store.listProducts()).filter(
    (p) => p.sku !== sku && p.category.id === product.category.id,
  );
  return (
    <Localize>
      {
        <>
          <SiteHeader />
          <main id="main-content" className="site-width product-page">
            <nav className="breadcrumbs" aria-label="Път до продукта">
              <Link href="/">Начало</Link>
              <span>/</span>
              <Link href="/catalog">Каталог</Link>
              <span>/</span>
              <Link
                href={{
                  pathname: "/catalog",
                  query: { category: product.category.id },
                }}
              >
                {product.category.name}
              </Link>
              {subcategory && (
                <>
                  <span>/</span>
                  <Link
                    href={{
                      pathname: "/catalog",
                      query: {
                        category: product.category.id,
                        subcategory: subcategory.id,
                      },
                    }}
                  >
                    {subcategory.name}
                  </Link>
                </>
              )}
              <span>/</span>
              <span>{product.name}</span>
            </nav>
            <div className="product-detail">
              <div className="product-detail-photo">
                <Image
                  src={product.image}
                  alt={"Илюстрация: " + product.name}
                  fill
                  priority
                  sizes="(max-width: 800px) 100vw, 50vw"
                />
                <span className="product-demo-tag">ИЛЮСТРАЦИЯ</span>
              </div>
              <section className="product-detail-info">
                <p className="eyebrow">{product.category.name}</p>
                <h1>{product.name}</h1>
                <p className="intro">{product.description}</p>
                <dl className="product-specs">
                  <div>
                    <dt>Продуктов код</dt>
                    <dd>{product.sku}</dd>
                  </div>
                  <div>
                    <dt>Демо наличност</dt>
                    <dd>
                      {availableStock(product.stock) > 0
                        ? "Свободни бройки"
                        : "Няма свободни бройки"}
                    </dd>
                  </div>
                </dl>
                <ProductPrice product={product} />
                <p className="demo-notice">
                  Демонстрационен продукт с илюстративно изображение. Реални
                  снимки, спецификации и проверена съвместимост предстоят. Все
                  още не приемаме поръчки.
                </p>
                <AddToCart product={product} allowQuantity />
                <ProductActions product={product} />
                <Link className="button" href="/catalog">
                  Към каталога <Icon name="arrow" />
                </Link>
              </section>
            </div>
            <section
              className="product-information-panels"
              aria-label={text("Информация за продукта", "Product information")}
            >
              <details open>
                <summary>
                  {text("Описание и детайли", "Description & details")}
                </summary>
                <p>{product.description}</p>
                <dl className="product-specs">
                  <div>
                    <dt>{text("Категория", "Category")}</dt>
                    <dd>{product.category.name}</dd>
                  </div>
                  <div>
                    <dt>SKU</dt>
                    <dd>{product.sku}</dd>
                  </div>
                  <div>
                    <dt>
                      {text("Свободни демо бройки", "Available demo units")}
                    </dt>
                    <dd>{availableStock(product.stock)}</dd>
                  </div>
                </dl>
              </details>
              <details>
                <summary>
                  {text("Съвместимост с автомобил", "Vehicle compatibility")}
                </summary>
                {fitInfo?.universal ? (
                  <p>
                    {text(
                      "Универсален продукт — подходящ за всеки автомобил.",
                      "Universal product — fits every vehicle.",
                    )}
                  </p>
                ) : fitInfo?.fitments.length ? (
                  <div className="table-wrapper">
                    <table>
                      <caption className="visually-hidden">
                        {text("Проверена съвместимост", "Verified fitment")}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">{text("Автомобил", "Vehicle")}</th>
                          <th scope="col">{text("Години", "Years")}</th>
                          <th scope="col">{text("Двигател", "Engine")}</th>
                          <th scope="col">{text("Бележка", "Note")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fitInfo.fitments.map((f, index) => (
                          <tr key={index}>
                            <td>
                              {f.make} {f.model} {f.generation}
                            </td>
                            <td>{years(f)}</td>
                            <td>{f.engine ?? text("Всички", "All")}</td>
                            <td>{f.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>
                    {text(
                      "Проверената съвместимост за този продукт още не е въведена. Не избирай част само по снимката. Запази точния модел, година и двигател в гаража си.",
                      "Verified compatibility for this product has not been entered yet. Do not choose a part based only on its photo. Save the exact model, year and engine in your garage.",
                    )}
                  </p>
                )}
                <Link href="/garage" className="text-link">
                  {text("Към моя гараж →", "Go to my garage →")}
                </Link>
              </details>
              <details>
                <summary>
                  {text("Доставка и плащане", "Delivery & payment")}
                </summary>
                <p>
                  {text(
                    "В тестовата поръчка можеш да избереш Еконт или Спиди, до офис или адрес. Сумата за доставка се показва преди потвърждение. Наложеният платеж и картовото плащане са тестови — не се събират реални пари и не се заявява реална пратка.",
                    "In the test checkout, choose Econt or Speedy delivery to an office or address. Shipping is shown before confirmation. Cash on delivery and card payments are test payments — no real money is collected and no shipment is booked.",
                  )}
                </p>
                <Link href="/checkout" className="text-link">
                  {text(
                    "Разгледай тестовата поръчка →",
                    "Explore test checkout →",
                  )}
                </Link>
              </details>
            </section>
            {related.length > 0 && (
              <section className="related-products">
                <div className="section-heading">
                  <h2>
                    {text("Още в тази категория", "More in this category")}
                  </h2>
                  <Link
                    href={{
                      pathname: "/catalog",
                      query: { category: product.category.id },
                    }}
                  >
                    {text("Виж всички →", "View all →")}
                  </Link>
                </div>
                <div className="product-grid">
                  {related.map((item) => (
                    <ProductCard key={item.sku} product={item} />
                  ))}
                </div>
              </section>
            )}
          </main>
          <SiteFooter />
        </>
      }
    </Localize>
  );
}
