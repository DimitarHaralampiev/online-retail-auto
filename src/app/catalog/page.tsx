import type { Metadata } from "next";
import { pageMetadata, siteUrl } from "../../lib/seo";
import JsonLd from "../../components/json-ld";
import { breadcrumbJsonLd } from "../../lib/structured-data";
import Localize from "../../components/localize";
import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import { permanentRedirect } from "next/navigation";
import Catalog from "../../components/catalog";
import { currentCustomer, database } from "../../lib/accounts";
import { fitStatuses } from "../../lib/vehicles";
import { catalog, catalogSource } from "../../lib/catalog-server";
import { selectedVehicle } from "../../lib/vehicle-selection-server";
import VehicleSelector from "../../components/vehicle-selector";
import {
  browseQueryFor,
  catalogHref,
  parseCatalogUrl,
} from "../../lib/catalog-url";
import { requestLocale } from "../../lib/i18n/server";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const parsed = parseCatalogUrl(await searchParams);
  const locale = await requestLocale();
  const en = locale === "en";
  const taxonomy = await catalog(locale).taxonomy();
  const category = taxonomy.find((c) => c.id === parsed.category);
  const subcategory = category?.subcategories.find(
    (s) => s.id === parsed.subcategory,
  );
  // Category pages are indexable; searches and filter combinations point
  // to them and stay out of the index.
  const filtered =
    !!parsed.q ||
    !!parsed.min ||
    !!parsed.max ||
    parsed.available ||
    parsed.promotions ||
    parsed.car ||
    parsed.brands.length > 0 ||
    Object.keys(parsed.attributes).length > 0 ||
    parsed.sort !== "featured";
  const query = new URLSearchParams();
  if (category) query.set("category", category.id);
  if (category && subcategory) query.set("subcategory", subcategory.id);
  if (!filtered && parsed.page > 1) query.set("page", String(parsed.page));
  const path = query.size ? `/catalog?${query}` : "/catalog";
  const name = subcategory
    ? `${subcategory.name} — ${category!.name}`
    : (category?.name ?? (en ? "Catalog" : "Каталог"));
  return pageMetadata({
    locale,
    path,
    title:
      parsed.page > 1 && !filtered
        ? `${name} (${en ? "page" : "страница"} ${parsed.page})`
        : name,
    description: en
      ? `${subcategory?.name ?? category?.name ?? "Car accessories, parts and car care"} in the AUTO/SHOP catalog.`
      : `${subcategory?.name ?? category?.name ?? "Автоаксесоари, части и автокозметика"} в каталога на AUTO/SHOP.`,
    index: !filtered,
  });
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = parseCatalogUrl(await searchParams);
  const locale = await requestLocale();
  const store = catalog(locale);
  // Only categories that exist are applied (and shown back to the visitor).
  const taxonomy = await store.taxonomy();
  // Categories are addressed by id. Older links used the Bulgarian display
  // name, whatever the visitor's language: resolve those to the id.
  const legacyId =
    taxonomy.some((c) => c.id === parsed.category) || !parsed.category
      ? undefined
      : (await catalog().taxonomy()).find((c) => c.name === parsed.category)
          ?.id;
  const category = taxonomy.find((c) => c.id === (legacyId ?? parsed.category));
  const subcategory = taxonomy
    .flatMap((c) => c.subcategories.map((s) => ({ ...s, parent: c.id })))
    .find(
      (s) =>
        s.id === parsed.subcategory && (!category || s.parent === category.id),
    );
  // The vehicle reference lives in PostgreSQL; the static demo has none.
  const vehicles = catalogSource() === "postgres";
  const [selected, customer] = vehicles
    ? await Promise.all([
        selectedVehicle(),
        currentCustomer().catch(() => null),
      ])
    : [null, null];
  // The state the server actually applied; links are built from it.
  const state = {
    ...parsed,
    category: category?.id ?? subcategory?.parent ?? "",
    subcategory: subcategory?.id ?? "",
    // "Only for my car" applies only with a resolved selection.
    car: parsed.car && !!selected,
  };
  // An old link that named the category: send it to the one canonical URL.
  if (category && parsed.category !== category.id)
    permanentRedirect(catalogHref(state, { page: state.page }));
  const query = browseQueryFor(state, locale);
  const vehicle = selected && {
    generationId: selected.generationId,
    engineId: selected.engineId,
    year: selected.year,
  };
  const filtered = query && {
    ...query,
    vehicle: state.car && vehicle ? vehicle : undefined,
  };
  const [result, facets] = filtered
    ? await Promise.all([
        store.browse(filtered),
        // Facets are a convenience: the page works without them.
        store.facets(filtered).catch(() => null),
      ])
    : [null, null];
  // Attributes that no longer exist (or are not filterable) were ignored by
  // the query: keep them out of links and chips too.
  const applied = facets && {
    ...state,
    attributes: Object.fromEntries(
      Object.entries(state.attributes).filter(([key]) =>
        facets.attributes.some((facet) => facet.key === key),
      ),
    ),
  };
  const fit =
    vehicle && result
      ? await fitStatuses(
          database(),
          result.items.map((p) => p.sku),
          vehicle,
        ).catch(() => ({}))
      : {};
  return (
    <Localize>
      {
        <>
          <SiteHeader />
          {category && (
            <JsonLd
              data={breadcrumbJsonLd(
                [
                  { name: locale === "en" ? "Home" : "Начало", path: "/" },
                  {
                    name: locale === "en" ? "Catalog" : "Каталог",
                    path: "/catalog",
                  },
                  {
                    name: category.name,
                    path: `/catalog?category=${encodeURIComponent(category.id)}`,
                  },
                  ...(subcategory
                    ? [
                        {
                          name: subcategory.name,
                          path: `/catalog?category=${encodeURIComponent(category.id)}&subcategory=${encodeURIComponent(subcategory.id)}`,
                        },
                      ]
                    : []),
                ],
                siteUrl(),
              )}
            />
          )}
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
            {vehicles && (
              <div className="site-width">
                <VehicleSelector initial={selected} signedIn={!!customer} />
              </div>
            )}
            <section
              className="site-width catalog-section"
              aria-label="Продукти"
            >
              <Catalog
                state={applied ?? state}
                result={result}
                carFilter={state.car}
                vehicle={
                  vehicles ? { label: selected?.label ?? null } : undefined
                }
                fit={fit}
                brands={facets?.brands}
                attributes={facets?.attributes}
              />
            </section>
          </main>
          <SiteFooter />
        </>
      }
    </Localize>
  );
}
