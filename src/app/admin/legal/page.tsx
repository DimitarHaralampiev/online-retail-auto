import Link from "next/link";
import { database } from "../../../lib/accounts";
import { currentAdmin } from "../../../lib/admin-product-http";
import { requestLocale } from "../../../lib/i18n/server";
import { getLegalPage, LEGAL_SLUGS, LEGAL_TITLES } from "../../../lib/legal";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import LegalAdmin from "../../../components/legal-admin";

export default async function AdminLegalPage() {
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const admin = await currentAdmin();
  const pages = admin
    ? await Promise.all(
        LEGAL_SLUGS.map(async (slug) => ({
          ...(await getLegalPage(database(), slug)),
          title: LEGAL_TITLES[slug],
        })),
      )
    : null;
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin">← {text("Администрация", "Administration")}</Link>
          <p className="eyebrow">{text("ИНФОРМАЦИЯ", "INFORMATION")}</p>
          <h1>{text("Правни страници", "Legal pages")}</h1>
          <p>
            {text(
              "Постави текстовете, подготвени или одобрени от юрист. Магазинът не съставя правни текстове. Данните за търговеца идват от настройките COMPANY_*.",
              "Paste texts prepared or approved by a lawyer. The shop does not write legal texts. Trader details come from the COMPANY_* settings.",
            )}
          </p>
        </section>
        {pages ? (
          <LegalAdmin pages={pages} />
        ) : (
          <p>
            <Link href="/account">
              {text(
                "Влез с администраторски профил.",
                "Sign in with an administrator account.",
              )}
            </Link>
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
