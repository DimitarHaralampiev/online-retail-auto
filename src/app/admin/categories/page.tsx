import Link from "next/link";
import { database } from "../../../lib/accounts";
import { listAdminCategories } from "../../../lib/admin-categories";
import { currentAdmin } from "../../../lib/admin-product-http";
import { requestLocale } from "../../../lib/i18n/server";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import CategoryAdmin from "../../../components/category-admin";

export default async function AdminCategoriesPage() {
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const admin = await currentAdmin();
  const categories = admin ? await listAdminCategories(database()) : null;
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin/products">← {text("Продукти", "Products")}</Link>
          <p className="eyebrow">{text("КАТАЛОГ", "CATALOG")}</p>
          <h1>{text("Категории", "Categories")}</h1>
          <p>
            {text(
              "Категории и подкатегории на магазина: имена на двата езика, подредба и видимост. Неактивните категории скриват и продуктите си.",
              "The shop's categories and subcategories: names in both languages, order and visibility. Inactive categories also hide their products.",
            )}
          </p>
        </section>
        {categories ? (
          <CategoryAdmin categories={categories} />
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
