import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import InventoryDemo from "../../components/inventory-demo";

export default function InventoryDemoPage() {
  return (
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
            Публична демонстрация с измислени данни. Промените са само в тази
            страница и се губят при презареждане. Това не е административен
            панел.
          </p>
        </section>
        <InventoryDemo />
      </main>
      <SiteFooter />
    </>
  );
}
