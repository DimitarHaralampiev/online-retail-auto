// Shown for unknown addresses and notFound(), in the visitor's language with
// the shop around it (#134). Next.js answers 404 and adds noindex.
import type { Metadata } from "next";
import Link from "next/link";
import { requestLocale } from "../lib/i18n/server";
import { SITE_NAME } from "../lib/seo";
import Icon from "../components/icon";
import SiteFooter from "../components/site-footer";
import SiteHeader from "../components/site-header";

export async function generateMetadata(): Promise<Metadata> {
  const en = (await requestLocale()) === "en";
  return {
    title: `${en ? "Page not found" : "Страницата не е намерена"} — ${SITE_NAME}`,
  };
}

export default async function NotFound() {
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width error-page">
        <p className="eyebrow">404</p>
        <h1>{text("Няма такава страница.", "There is no such page.")}</h1>
        <p>
          {text(
            "Адресът може да е сгрешен или продуктът вече да не се предлага. Потърси го по име или код, или разгледай каталога.",
            "The address may be mistyped, or the product is no longer offered. Search by name or code, or explore the catalog.",
          )}
        </p>
        <p className="error-page-actions">
          <Link className="button" href="/catalog">
            {text("Към каталога", "To the catalog")} <Icon name="arrow" />
          </Link>
          <Link className="text-link" href="/">
            {text("Към началото", "To the home page")}
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
