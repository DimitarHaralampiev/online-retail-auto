import type { Metadata } from "next";
import { pageMetadata } from "../../../lib/seo";
import Link from "next/link";
import { notFound } from "next/navigation";
import { database } from "../../../lib/accounts";
import { makeBySlug, modelsOfMake } from "../../../lib/car-pages";
import { catalogSource } from "../../../lib/catalog-server";
import { requestLocale } from "../../../lib/i18n/server";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";

type Params = { params: Promise<{ make: string }> };

async function load(slug: string) {
  if (catalogSource() !== "postgres") return null;
  return makeBySlug(database(), slug).catch(() => null);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const make = await load((await params).make);
  if (!make) return {};
  const locale = await requestLocale();
  const en = locale === "en";
  return pageMetadata({
    locale,
    path: `/cars/${make.slug}`,
    title: en
      ? `${make.name} parts and accessories`
      : `Части и аксесоари за ${make.name}`,
    description: en
      ? `${make.name} models with parts of verified fitment.`
      : `Модели ${make.name} с части с проверена съвместимост.`,
  });
}

export default async function MakePage({ params }: Params) {
  const make = await load((await params).make);
  if (!make) notFound();
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const models = await modelsOfMake(database(), make.id);
  const years = (m: (typeof models)[number]) =>
    m.yearFrom === null
      ? ""
      : `${m.yearFrom}–${m.current ? text("днес", "today") : (m.yearTo ?? "")}`;
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <nav className="breadcrumbs" aria-label={text("Път", "Breadcrumb")}>
          <Link href="/cars">{text("Автомобили", "Cars")}</Link>
          <span>/</span>
          <span>{make.name}</span>
        </nav>
        <section className="page-intro">
          <p className="eyebrow">{text("МАРКА", "MAKE")}</p>
          <h1>{make.name}</h1>
        </section>
        {models.length === 0 ? (
          <p>{text("Все още няма модели.", "No models yet.")}</p>
        ) : (
          <ul className="car-list">
            {models.map((model) => (
              <li key={model.id}>
                <Link href={`/cars/${make.slug}/${model.slug}`}>
                  {make.name} {model.name}
                </Link>
                <small>
                  {years(model)} · {model.products}{" "}
                  {text("продукта", "products")}
                </small>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
