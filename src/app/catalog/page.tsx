import Localize from "../../components/localize";
import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import { permanentRedirect } from "next/navigation";
import Catalog from "../../components/catalog";
import { currentCustomer } from "../../lib/accounts";
import { MAX_COMPATIBLE_SKUS } from "../../lib/catalog";
import { catalog } from "../../lib/catalog-server";
import {
  browseQueryFor,
  catalogHref,
  parseCatalogUrl,
} from "../../lib/catalog-url";
import { getCustomerFeatures } from "../../lib/customer-features";
import { requestLocale } from "../../lib/i18n/server";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = parseCatalogUrl(await searchParams);
  const store = catalog();
  // Only categories that exist are applied (and shown back to the visitor).
  const taxonomy = await store.taxonomy();
  // Categories are addressed by id; older links used the display name.
  const category =
    taxonomy.find((c) => c.id === parsed.category) ??
    taxonomy.find((c) => c.name === parsed.category);
  const subcategory = taxonomy
    .flatMap((c) => c.subcategories.map((s) => ({ ...s, parent: c.id })))
    .find(
      (s) =>
        s.id === parsed.subcategory && (!category || s.parent === category.id),
    );
  const fitment = parsed.car ? await vehicleFitment() : undefined;
  // The state the server actually applied; links are built from it.
  const state = {
    ...parsed,
    category: category?.id ?? subcategory?.parent ?? "",
    subcategory: subcategory?.id ?? "",
    car: !!fitment,
  };
  // An old link that named the category: send it to the one canonical URL.
  if (category && parsed.category !== category.id)
    permanentRedirect(catalogHref(state, { page: state.page }));
  const query = browseQueryFor(state, await requestLocale());
  const result = query
    ? await store.browse({ ...query, compatibleSkus: fitment })
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
              <Catalog state={state} result={result} carFilter={state.car} />
            </section>
          </main>
          <SiteFooter />
        </>
      }
    </Localize>
  );
}

/**
 * SKUs that fit the signed-in customer's selected vehicle, or undefined when
 * the filter cannot apply (no session, no selected vehicle, too many matches
 * or a database error): the page then shows the unfiltered catalog.
 */
async function vehicleFitment(): Promise<string[] | undefined> {
  try {
    const customer = await currentCustomer();
    if (!customer) return undefined;
    const features = await getCustomerFeatures(customer.id);
    if (!features.vehicles.some((vehicle) => vehicle.selected))
      return undefined;
    if (features.compatibleSkus.length > MAX_COMPATIBLE_SKUS) return undefined;
    return features.compatibleSkus;
  } catch {
    return undefined;
  }
}
