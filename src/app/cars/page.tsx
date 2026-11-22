import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { database } from "../../lib/accounts";
import { makesWithCounts } from "../../lib/car-pages";
import { catalogSource } from "../../lib/catalog-server";
import { requestLocale } from "../../lib/i18n/server";
import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await requestLocale()) === "en";
  return {
    title: en
      ? "Parts by car make — AUTO/SHOP"
      : "Части по марка автомобил — AUTO/SHOP",
    description: en
      ? "Choose your car make to see parts with verified fitment."
      : "Избери марката на автомобила си и виж частите с проверена съвместимост.",
  };
}

export default async function CarsPage() {
  // The vehicle reference lives in PostgreSQL; the static demo has none.
  if (catalogSource() !== "postgres") notFound();
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const makes = await makesWithCounts(database());
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <p className="eyebrow">{text("ПО АВТОМОБИЛ", "BY CAR")}</p>
          <h1>{text("Части по марка", "Parts by make")}</h1>
          <p>
            {text(
              "Показваме само части с проверена съвместимост за съответния автомобил.",
              "We only list parts with verified fitment for each car.",
            )}
          </p>
        </section>
        {makes.length === 0 ? (
          <p>
            {text(
              "Справочникът на автомобили още се попълва.",
              "The vehicle reference is still being filled in.",
            )}
          </p>
        ) : (
          <ul className="car-list">
            {makes.map((make) => (
              <li key={make.id}>
                <Link href={`/cars/${make.slug}`}>{make.name}</Link>
                <small>
                  {make.models} {text("модела", "models")} · {make.products}{" "}
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
