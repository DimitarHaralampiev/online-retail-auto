import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import Catalog from "../../components/catalog";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const params = await searchParams;
  const category = typeof params.category === "string" ? params.category : "";
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="catalog-main">
        <section className="catalog-heading site-width">
          <p className="eyebrow">ПОДБРАНО ЗА ТВОЯ АВТОМОБИЛ</p>
          <div className="catalog-title-row">
            <h1>
              ДОБРИЯТ ИЗБОР.
              <br />
              <span>ДО ПОСЛЕДНИЯ ДЕТАЙЛ.</span>
            </h1>
            <p>
              Аксесоари, части и грижа.
              <br />
              Намери своята следваща стъпка.
            </p>
          </div>
          <p className="demo-notice">
            Демо каталог · Примерни продукти, наличности и илюстративни
            изображения. Поръчките предстоят.
          </p>
        </section>
        <section className="site-width catalog-section" aria-label="Продукти">
          <Catalog key={category} initialCategory={category} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
