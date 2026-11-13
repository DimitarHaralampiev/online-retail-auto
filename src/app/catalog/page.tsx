import Localize from "../../components/localize";
import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import Catalog from "../../components/catalog";
import { currentCustomer } from "../../lib/accounts";
import { catalog } from "../../lib/catalog-server";
import { browseQueryFor, parseCatalogUrl } from "../../lib/catalog-url";
import { getCustomerFeatures } from "../../lib/customer-features";
import { requestLocale } from "../../lib/i18n/server";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = parseCatalogUrl(await searchParams);
  const query = browseQueryFor(state, await requestLocale());
  // Vehicle fitment comes from the signed-in customer's selected vehicle,
  // never from the URL.
  let compatibleSkus: string[] | undefined;
  if (query && state.car) {
    const customer = await currentCustomer().catch(() => null);
    if (customer) {
      const features = await getCustomerFeatures(customer.id);
      if (features.vehicles.some((vehicle) => vehicle.selected))
        compatibleSkus = features.compatibleSkus;
    }
  }
  const result = query
    ? await catalog().browse({ ...query, compatibleSkus })
    : null;
  return (
    <Localize>
      {
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
            <section
              className="site-width catalog-section"
              aria-label="Продукти"
            >
              <Catalog
                state={state}
                result={result}
                carFilter={!!compatibleSkus}
              />
            </section>
          </main>
          <SiteFooter />
        </>
      }
    </Localize>
  );
}
