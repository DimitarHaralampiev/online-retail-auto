import { requestLocale } from "../lib/i18n/server";
import LocaleProvider from "../components/locale-provider";
import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/roboto-condensed";
import "./globals.css";
import CartProvider from "../components/cart-provider";
import CatalogProvider from "../components/catalog-provider";
import { catalog } from "../lib/catalog-server";

import CustomerProvider from "../components/customer-provider";
import AccountProvider from "../components/account-provider";

export const metadata: Metadata = {
  title: "Авто магазин — в разработка",
  description:
    "Подготвяме онлайн магазин за автоаксесоари и части за България.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const store = catalog();
  const [locale, taxonomy] = await Promise.all([
    requestLocale(),
    store.taxonomy(),
  ]);
  return (
    <html lang={locale}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <CatalogProvider taxonomy={taxonomy}>
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
