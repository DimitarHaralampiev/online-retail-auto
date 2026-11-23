import Link from "next/link";
import { database } from "../../../lib/accounts";
import { listAttributes } from "../../../lib/admin-attributes";
import { currentAdmin } from "../../../lib/admin-product-http";
import { requestLocale } from "../../../lib/i18n/server";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import AttributeAdmin from "../../../components/attribute-admin";

export default async function AdminAttributesPage() {
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const admin = await currentAdmin();
  const attributes = admin ? await listAttributes(database()) : null;
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin/products">← {text("Продукти", "Products")}</Link>
          <p className="eyebrow">{text("КАТАЛОГ", "CATALOG")}</p>
          <h1>{text("Характеристики", "Attributes")}</h1>
          <p>
            {text(
              "Свойства на продуктите, например вискозитет или дължина. Стойностите се въвеждат в продукта или чрез CSV импорта; филтрите в каталога показват само стойности на видими продукти.",
              "Product properties such as viscosity or length. Enter values on the product or through the CSV import; catalog filters show only values of visible products.",
            )}
          </p>
        </section>
        {attributes ? (
          <AttributeAdmin attributes={attributes} />
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
