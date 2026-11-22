import { requestLocale } from "../lib/i18n/server";
import LocaleProvider from "../components/locale-provider";
import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/roboto-condensed";
import "./globals.css";
import CartProvider from "../components/cart-provider";
import CatalogProvider from "../components/catalog-provider";
import { catalog } from "../lib/catalog-server";
import { indexable, SITE_NAME, siteUrl } from "../lib/seo";

import CustomerProvider from "../components/customer-provider";
import AccountProvider from "../components/account-provider";

// Defaults for every page. Pages that may be indexed opt in through
// pageMetadata() (src/lib/seo.ts); everything else (cart, account, admin…)
// stays noindex.
export async function generateMetadata(): Promise<Metadata> {
  const en = (await requestLocale()) === "en";
  return {
    metadataBase: siteUrl(),
    title: en
      ? `${SITE_NAME} — car accessories and parts`
      : `${SITE_NAME} — автоаксесоари и части`,
    description: en
      ? "Online shop for car accessories and parts in Bulgaria."
      : "Онлайн магазин за автоаксесоари и части за България.",
    robots: { index: false, follow: indexable() },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await requestLocale();
  const taxonomy = await catalog(locale).taxonomy();
  return (
    <html lang={locale}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <CatalogProvider taxonomy={taxonomy} locale={locale}>
            <AccountProvider>
              <CustomerProvider>
                <CartProvider>{children}</CartProvider>
              </CustomerProvider>
            </AccountProvider>
          </CatalogProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
