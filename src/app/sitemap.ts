// /sitemap.xml (#41): fixed pages, categories, subcategories and, with the
// vehicle reference, the car pages. Products are in /sitemaps/products/N.
// Built per request: the catalog lives in the database at run time.
import type { MetadataRoute } from "next";
import { database } from "../lib/accounts";
import { makesWithCounts, modelsOfMake } from "../lib/car-pages";
import { catalog, catalogSource } from "../lib/catalog-server";
import { getLegalPage, LEGAL_SLUGS } from "../lib/legal";
import { siteUrl } from "../lib/seo";
import { localizedEntries } from "../lib/sitemap";

export const dynamic = "force-dynamic";

async function carPaths(): Promise<string[]> {
  if (catalogSource() !== "postgres") return [];
  try {
    const db = database();
    const makes = await makesWithCounts(db);
    const paths = makes.length ? ["/cars"] : [];
    for (const make of makes) {
      paths.push(`/cars/${make.slug}`);
      for (const model of await modelsOfMake(db, make.id))
        paths.push(`/cars/${make.slug}/${model.slug}`);
    }
    return paths;
  } catch {
    return [];
  }
}

/** Legal pages with published (non-empty) text. */
async function legalPaths(): Promise<string[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const pages = await Promise.all(
      LEGAL_SLUGS.map((slug) => getLegalPage(database(), slug)),
    );
    return pages
      .filter((page) => page.contentBg.trim())
      .map((page) => `/legal/${page.slug}`);
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const taxonomy = await catalog().taxonomy();
  const paths = ["/", "/catalog", "/promotions"];
  for (const category of taxonomy) {
    paths.push(`/catalog?category=${encodeURIComponent(category.id)}`);
    for (const sub of category.subcategories)
      paths.push(
        `/catalog?category=${encodeURIComponent(category.id)}&subcategory=${encodeURIComponent(sub.id)}`,
      );
  }
  paths.push(...(await carPaths()), ...(await legalPaths()));
  return paths.flatMap((path) => localizedEntries(base, path));
}
