import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/roboto-condensed";
import "./globals.css";
import CartProvider from "../components/cart-provider";

import AccountProvider from "../components/account-provider";

export const metadata: Metadata = {
  title: "Авто магазин — в разработка",
  description:
    "Подготвяме онлайн магазин за автоаксесоари и части за България.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="bg">
      <body>
        <AccountProvider>
          <CartProvider>{children}</CartProvider>
        </AccountProvider>
      </body>
    </html>
  );
}
