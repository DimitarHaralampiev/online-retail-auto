import type { Metadata } from "next";
import { pageMetadata } from "../../lib/seo";
import { requestLocale } from "../../lib/i18n/server";
import Localize from "../../components/localize";
import Link from "next/link";
import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import ProductCard from "../../components/product-card";
import Icon from "../../components/icon";
import { catalog } from "../../lib/catalog-server";
import { parseCatalogUrl } from "../../lib/catalog-url";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const pageHref = (page: number) =>
  page > 1 ? `/promotions?page=${page}` : "/promotions";
const pageFrom = async (searchParams: Props["searchParams"]) =>
  parseCatalogUrl(await searchParams).page;

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const locale = await requestLocale();
  const page = await pageFrom(searchParams);
  const en = locale === "en";
  const title = en ? "Promotions" : "Промоции";
  return pageMetadata({
    locale,
    path: pageHref(page),
    title: page > 1 ? `${title} (${en ? "page" : "страница"} ${page})` : title,
    description: en
      ? "Current promotions on car accessories, parts and car care."
      : "Актуални промоции на автоаксесоари, части и автокозметика.",
  });
}

export default async function PromotionsPage({ searchParams }: Props) {
  const locale = await requestLocale();
  const text = (bg: string, english: string) =>
    locale === "en" ? english : bg;
  const result = await catalog(locale).browse({
    promotions: true,
    page: await pageFrom(searchParams),
  });
  const products = result.items;
  return (
    <Localize>
      {
        <>
          <SiteHeader />
          <main id="main-content" className="promotions-main">
            <section className="site-width promotions-heading">
              <p className="eyebrow">ПРОМОЦИИ / ПОДБРАНИ ПРЕДЛОЖЕНИЯ</p>
              <div className="catalog-title-row">
                <h1>
                  ДОБЪР ИЗБОР.
                  <br />
                  <span>ПО-ДОБРА ЦЕНА.</span>
                </h1>
                <Link className="text-link" href="/catalog">
                  Целият каталог <Icon name="arrow" />
                </Link>
              </div>
              <p className="demo-notice">
                Примерни намаления и цени. Това са демонстрационни оферти; все
                още не приемаме реални поръчки.
              </p>
            </section>
            <section
              className="site-width promotions-products"
              aria-label="Продукти с намаление"
            >
              <div className="catalog-results">
                <p>
                  Предложения: <strong>{result.total}</strong>
                </p>
                <span>ДЕМО ПРОМОЦИИ</span>
              </div>
              {products.length ? (
                <div className="product-grid">
                  {products.map((product) => (
                    <ProductCard key={product.sku} product={product} />
                  ))}
                </div>
              ) : result.total > 0 ? (
                <div className="empty">
                  <h2>
                    {text("Няма такава страница.", "There is no such page.")}
                  </h2>
                  <Link className="text-link" href={pageHref(1)}>
                    {text("Към първата страница", "Go to the first page")}{" "}
                    <Icon name="arrow" />
                  </Link>
                </div>
              ) : (
                <div className="empty">
                  <h2>В момента няма предложения.</h2>
                  <Link className="text-link" href="/catalog">
                    Разгледай каталога <Icon name="arrow" />
                  </Link>
                </div>
              )}
              {result.pageCount > 1 && products.length > 0 && (
                <nav
                  className="catalog-pagination"
                  aria-label={text("Страници", "Pages")}
                >
                  {result.page > 1 && (
                    <Link href={pageHref(result.page - 1)}>
                      ← {text("Предишна", "Previous")}
                    </Link>
                  )}
                  <span>
                    {text(
                      `Страница ${result.page} от ${result.pageCount}`,
                      `Page ${result.page} of ${result.pageCount}`,
                    )}
                  </span>
                  {result.page < result.pageCount && (
                    <Link href={pageHref(result.page + 1)}>
                      {text("Следваща", "Next")} →
                    </Link>
                  )}
                </nav>
              )}
            </section>
          </main>
          <SiteFooter />
        </>
      }
    </Localize>
  );
}
