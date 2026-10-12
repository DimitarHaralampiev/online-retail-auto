import Link from "next/link";
import { currentCustomer, database } from "../../../lib/accounts";
import { requestLocale } from "../../../lib/i18n/server";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import ProductMediaAdmin from "../../../components/product-media-admin";
export default async function ProductMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string }>;
}) {
  const admin = await currentCustomer();
  const en = (await requestLocale()) === "en";
  const query = await searchParams;
  const result = admin?.isAdmin
    ? await database().query(
        "SELECT sku,name,on_hand FROM warehouse_products ORDER BY sku",
      )
    : null;
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin">← {en ? "Administration" : "Администрация"}</Link>
          <p className="eyebrow">
            {en ? "PRODUCT CONTENT" : "ПРОДУКТОВО СЪДЪРЖАНИЕ"}
          </p>
          <h1>{en ? "Photos. Video. Details." : "Снимки. Видео. Детайли."}</h1>
          <p>
            {en
              ? "Give each product its own gallery."
              : "Дай на всеки продукт собствена галерия."}
          </p>
        </section>
        {admin?.isAdmin ? (
          <ProductMediaAdmin
            products={result!.rows}
            initialSku={
              result!.rows.some((p) => p.sku === query.sku) ? query.sku! : ""
            }
          />
        ) : (
          <p>
            <Link href="/account">
              {en
                ? "Sign in with an administrator account."
                : "Влез с администраторски профил."}
            </Link>
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
