import { requestLocale } from "../lib/i18n/server";
import LocaleProvider from "../components/locale-provider";
import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/roboto-condensed";
import "./globals.css";
import CartProvider from "../components/cart-provider";

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
  const locale = await requestLocale();
  return (
    <html lang={locale}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <AccountProvider>
            <CustomerProvider>
              <CartProvider>{children}</CartProvider>
            </CustomerProvider>
          </AccountProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
