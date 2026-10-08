import Link from "next/link";
import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import ProductCard from "../../components/product-card";
import Icon from "../../components/icon";
import { demoProducts } from "../../lib/catalog";
import { getPromotion } from "../../lib/pricing";

export default function PromotionsPage() {
  const products = demoProducts.filter((product) => getPromotion(product));
  return (
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
            Примерни намаления и цени. Това са демонстрационни оферти; все още
            не приемаме реални поръчки.
          </p>
        </section>
        <section
          className="site-width promotions-products"
          aria-label="Продукти с намаление"
        >
          <div className="catalog-results">
            <p>
              Предложения: <strong>{products.length}</strong>
            </p>
            <span>ДЕМО ПРОМОЦИИ</span>
          </div>
          {products.length ? (
            <div className="product-grid">
              {products.map((product) => (
                <ProductCard key={product.sku} product={product} />
              ))}
            </div>
          ) : (
            <div className="empty">
              <h2>В момента няма предложения.</h2>
              <Link className="text-link" href="/catalog">
                Разгледай каталога <Icon name="arrow" />
              </Link>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
