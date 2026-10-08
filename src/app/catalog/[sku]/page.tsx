import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { demoProducts } from "../../../lib/catalog";
import { availableStock } from "../../../lib/inventory";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import Icon from "../../../components/icon";
import AddToCart from "../../../components/add-to-cart";
import { formatMoney } from "../../../lib/cart";

export function generateStaticParams() {
  return demoProducts.map(({ sku }) => ({ sku }));
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ sku: string }>;
}) {
  const { sku } = await params;
  const product = demoProducts.find((item) => item.sku === sku);
  if (!product) notFound();
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width product-page">
        <nav className="breadcrumbs" aria-label="Път до продукта">
          <Link href="/catalog">Каталог</Link>
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
            <p className="eyebrow">{product.category}</p>
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
              <div>
                <dt>Примерна цена</dt>
                <dd>{formatMoney(product.demoPriceCents)}</dd>
              </div>
            </dl>
            <p className="demo-notice">
              Демонстрационен продукт с илюстративно изображение. Реални снимки,
              спецификации и проверена съвместимост предстоят. Все още не
              приемаме поръчки.
            </p>
            <AddToCart product={product} />
            <Link className="button" href="/catalog">
              Към каталога <Icon name="arrow" />
            </Link>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
