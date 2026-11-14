import { requestLocale } from "../../lib/i18n/server";
import Localize from "../../components/localize";
import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import InventoryDemo from "../../components/inventory-demo";
import { catalog } from "../../lib/catalog-server";

export default async function InventoryDemoPage() {
  const products = await catalog(await requestLocale()).listProducts();
  return (
    <Localize>
      {
        <>
          <SiteHeader />
          <main id="main-content" className="site-width inventory-page">
            <section className="page-intro">
              <p className="eyebrow">ЗАД КУЛИСИТЕ / ДЕМО СКЛАД</p>
              <h1>
                НАЛИЧНОСТИ.
                <br />
                <span>ВСИЧКО НА МЯСТО.</span>
              </h1>
              <p className="demo-notice">
                Публична демонстрация с измислени данни. Промените са само в
                тази страница и се губят при презареждане. Това не е
                административен панел.
              </p>
            </section>
            <InventoryDemo products={products} />
          </main>
          <SiteFooter />
        </>
      }
    </Localize>
  );
}
