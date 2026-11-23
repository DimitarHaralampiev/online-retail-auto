import { requestLocale } from "../lib/i18n/server";
import LocaleProvider from "../components/locale-provider";
import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/roboto-condensed";
import "./globals.css";
import CartProvider from "../components/cart-provider";
import VehicleProvider from "../components/vehicle-provider";
import { selectedVehicle } from "../lib/vehicle-selection-server";
import ConsentProvider, { ConsentGate } from "../components/consent-provider";
import FieldVitals from "../components/field-vitals";
import {
  browserErrorsEnabled,
  fieldVitalsEnabled,
} from "../lib/client-reports";
import { CONSENT_COOKIE, consentCategoriesInUse } from "../lib/consent";
import { cookies } from "next/headers";
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
  const [taxonomy, vehicle] = await Promise.all([
    catalog(locale).taxonomy(),
    selectedVehicle(),
  ]);
  return (
    <html
      lang={locale}
      data-browser-errors={browserErrorsEnabled() ? undefined : "off"}
    >
      <body>
        <LocaleProvider initialLocale={locale}>
          <ConsentProvider
            initialConsent={(await cookies()).get(CONSENT_COOKIE)?.value}
            categories={consentCategoriesInUse()}
          >
            {fieldVitalsEnabled() && (
              <ConsentGate category="analytics">
                <FieldVitals />
              </ConsentGate>
            )}
            <CatalogProvider taxonomy={taxonomy} locale={locale}>
              <AccountProvider>
                <CustomerProvider>
                  <CartProvider>
                    <VehicleProvider
                      vehicle={vehicle ? { label: vehicle.label } : null}
                    >
                      {children}
                    </VehicleProvider>
                  </CartProvider>
                </CustomerProvider>
              </AccountProvider>
            </CatalogProvider>
          </ConsentProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
