import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { database } from "../../../lib/accounts";
import { requestLocale } from "../../../lib/i18n/server";
import {
  companyDetails,
  getLegalPage,
  isLegalSlug,
  LEGAL_SLUGS,
  LEGAL_TITLES,
  legalText,
  type LegalPage,
  type LegalSlug,
} from "../../../lib/legal";
import { pageMetadata } from "../../../lib/seo";
import LegalText from "../../../components/legal-text";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";

type Params = { params: Promise<{ slug: string }> };

async function load(slug: LegalSlug): Promise<LegalPage | null> {
  // Without a database there is no business text yet: show the placeholder.
  if (!process.env.DATABASE_URL) return null;
  return getLegalPage(database(), slug).catch(() => null);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  if (!isLegalSlug(slug)) notFound();
  const locale = await requestLocale();
  const page = await load(slug);
  const [bg, en] = LEGAL_TITLES[slug];
  return pageMetadata({
    locale,
    path: `/legal/${slug}`,
    title: locale === "en" ? en : bg,
    description:
      locale === "en" ? `${en} of AUTO/SHOP.` : `${bg} на AUTO/SHOP.`,
    // A placeholder page is not indexed.
    index: !!page?.contentBg.trim(),
  });
}

export default async function LegalPageView({ params }: Params) {
  const { slug } = await params;
  if (!isLegalSlug(slug)) notFound();
  const locale = await requestLocale();
  const en = locale === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const page = await load(slug);
  const shown = page ? legalText(page, locale) : { text: "", fallback: false };
  const company = companyDetails();
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page legal-page">
        <section className="page-intro">
          <p className="eyebrow">{text("ИНФОРМАЦИЯ", "INFORMATION")}</p>
          <h1>{text(...LEGAL_TITLES[slug])}</h1>
          {page?.updatedAt && shown.text && (
            <p>
              {text("Последна промяна: ", "Last updated: ")}
              <time dateTime={page.updatedAt}>
                {new Date(page.updatedAt).toLocaleDateString(
                  en ? "en-GB" : "bg-BG",
                  {
                    timeZone: "Europe/Sofia",
                  },
                )}
              </time>
            </p>
          )}
        </section>
        {shown.text ? (
          <article
            className="checkout-panel"
            lang={shown.fallback ? "bg" : locale}
          >
            {shown.fallback && (
              <p className="note" lang="en">
                This text is available in Bulgarian only.
              </p>
            )}
            <LegalText source={shown.text} />
          </article>
        ) : (
          <p className="checkout-panel" role="status">
            {text(
              "Този текст все още не е публикуван. Магазинът още не приема поръчки.",
              "This text has not been published yet. The shop does not take orders yet.",
            )}
          </p>
        )}
        {company.length > 0 && (
          <section className="checkout-panel" aria-labelledby="trader">
            <h2 id="trader">{text("Данни за търговеца", "Trader details")}</h2>
            <dl className="product-specs">
              {company.map((field) => (
                <div key={field.label[0]}>
                  <dt>{text(...field.label)}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        <nav aria-label={text("Други страници", "Other pages")}>
          <ul className="legal-links">
            {LEGAL_SLUGS.filter((s) => s !== slug).map((other) => (
              <li key={other}>
                <Link href={`/legal/${other}`}>
                  {text(...LEGAL_TITLES[other])}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <SiteFooter />
    </>
  );
}
