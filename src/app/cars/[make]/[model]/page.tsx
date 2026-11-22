import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { database } from "../../../../lib/accounts";
import {
  generationsOfModel,
  makeBySlug,
  modelBySlug,
  modelProductSkus,
} from "../../../../lib/car-pages";
import { catalog, catalogSource } from "../../../../lib/catalog-server";
import { requestLocale } from "../../../../lib/i18n/server";
import SiteHeader from "../../../../components/site-header";
import SiteFooter from "../../../../components/site-footer";
import ProductCard from "../../../../components/product-card";

type Params = { params: Promise<{ make: string; model: string }> };

async function load(params: Params["params"]) {
  if (catalogSource() !== "postgres") return null;
  const { make: makeSlug, model: modelSlug } = await params;
  try {
    const db = database();
    const make = await makeBySlug(db, makeSlug);
    const model = make && (await modelBySlug(db, make.id, modelSlug));
    return make && model ? { make, model } : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = await load(params);
  if (!found) return {};
  const { make, model } = found;
  const en = (await requestLocale()) === "en";
  return {
    title: en
      ? `${make.name} ${model.name} parts — AUTO/SHOP`
      : `Части за ${make.name} ${model.name} — AUTO/SHOP`,
    description: en
      ? `Parts with verified fitment for the ${make.name} ${model.name}.`
      : `Части с проверена съвместимост за ${make.name} ${model.name}.`,
    alternates: { canonical: `/cars/${make.slug}/${model.slug}` },
  };
}

export default async function ModelPage({ params }: Params) {
  const found = await load(params);
  if (!found) notFound();
  const { make, model } = found;
  const locale = await requestLocale();
  const en = locale === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const db = database();
  const [generations, fitted] = await Promise.all([
    generationsOfModel(db, model.id),
    modelProductSkus(db, model.id),
  ]);
  const products = await catalog(locale).getProducts(fitted.skus);
  // Grouped by category, in catalog order within each group.
  const groups = new Map<string, typeof products>();
  for (const product of products) {
    const name = product.category.name;
    groups.set(name, [...(groups.get(name) ?? []), product]);
  }
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <nav className="breadcrumbs" aria-label={text("Път", "Breadcrumb")}>
          <Link href="/cars">{text("Автомобили", "Cars")}</Link>
          <span>/</span>
          <Link href={`/cars/${make.slug}`}>{make.name}</Link>
          <span>/</span>
          <span>{model.name}</span>
        </nav>
        <section className="page-intro">
          <p className="eyebrow">{text("МОДЕЛ", "MODEL")}</p>
          <h1>
            {make.name} {model.name}
          </h1>
          <p>
            {text(
              "Части с проверена съвместимост за поне едно поколение на модела. Избери точния автомобил в каталога, за да видиш какво пасва на твоя двигател и година.",
              "Parts with verified fitment for at least one generation of this model. Choose your exact car in the catalog to see what fits your engine and year.",
            )}
          </p>
          <Link className="button" href="/catalog">
            {text(
              "Избери автомобила в каталога",
              "Choose your car in the catalog",
            )}
          </Link>
        </section>
        {generations.length > 0 && (
          <section className="checkout-panel">
            <h2>{text("Поколения", "Generations")}</h2>
            <ul>
              {generations.map((g) => (
                <li key={g.id}>
                  {g.name}: {g.yearFrom}–{g.yearTo ?? text("днес", "today")}
                  {g.engines > 0 &&
                    ` · ${g.engines} ${text("двигателя", "engines")}`}
                </li>
              ))}
            </ul>
          </section>
        )}
        {products.length === 0 ? (
          <p>
            {text(
              "Все още няма въведена проверена съвместимост за този модел.",
              "No verified fitment has been entered for this model yet.",
            )}
          </p>
        ) : (
          [...groups].map(([category, items]) => (
            <section key={category} className="related-products">
              <h2>{category}</h2>
              <div className="product-grid">
                {items.map((product) => (
                  <ProductCard key={product.sku} product={product} />
                ))}
              </div>
            </section>
          ))
        )}
        {fitted.total > fitted.skus.length && (
          <p>
            {text(
              `Показани са ${fitted.skus.length} от ${fitted.total} продукта. Избери автомобила си в каталога за всички.`,
              `Showing ${fitted.skus.length} of ${fitted.total} products. Choose your car in the catalog to see all.`,
            )}
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
