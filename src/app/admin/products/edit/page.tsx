import Link from "next/link";
import { notFound } from "next/navigation";
import { database } from "../../../../lib/accounts";
import { currentAdmin } from "../../../../lib/admin-product-http";
import {
  getAdminProduct,
  listAdminCategories,
  productHistory,
  skuSchema,
} from "../../../../lib/admin-products";
import { requestLocale } from "../../../../lib/i18n/server";
import SiteHeader from "../../../../components/site-header";
import SiteFooter from "../../../../components/site-footer";
import ProductAdminForm from "../../../../components/product-admin-form";

const ACTIONS: Record<string, [string, string]> = {
  "product.create": ["Създаден", "Created"],
  "product.update": ["Редактиран", "Edited"],
  "product.status": ["Смяна на статус", "Status change"],
};

export default async function EditProductPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const admin = await currentAdmin();
  const rawSku = typeof params.sku === "string" ? params.sku : undefined;
  let content: React.ReactNode;
  let title = text("Нов продукт", "New product");
  if (!admin) {
    content = (
      <p>
        <Link href="/account">
          {text(
            "Влез с администраторски профил.",
            "Sign in with an administrator account.",
          )}
        </Link>
      </p>
    );
  } else {
    const parsedSku = rawSku === undefined ? null : skuSchema.safeParse(rawSku);
    if (parsedSku && !parsedSku.success) notFound();
    const sku = parsedSku?.data;
    const [product, categories, history] = await Promise.all([
      sku ? getAdminProduct(database(), sku) : null,
      listAdminCategories(database()),
      sku ? productHistory(database(), sku) : [],
    ]);
    if (sku && !product) notFound();
    if (product) title = product.name.bg;
    content = (
      <>
        {params.created === "1" && (
          <p role="status">
            {text(
              "Черновата е създадена. Публикувай я, когато е готова.",
              "Draft created. Publish it when it is ready.",
            )}
          </p>
        )}
        <ProductAdminForm
          key={product?.sku ?? "new"}
          product={product}
          categories={categories}
        />
        {product && (
          <section className="checkout-panel">
            <h2>{text("История на промените", "Change history")}</h2>
            <p>
              <Link
                href={`/admin/products/media?sku=${encodeURIComponent(product.sku)}`}
              >
                {text("Снимки и видео →", "Photos and video →")}
              </Link>
            </p>
            <ol className="admin-product-history">
              {history.map((entry, index) => (
                <li key={index}>
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString(
                      en ? "en-GB" : "bg-BG",
                      { timeZone: "Europe/Sofia" },
                    )}
                  </time>{" "}
                  ·{" "}
                  {text(
                    ...(ACTIONS[entry.action] ?? [entry.action, entry.action]),
                  )}
                  {entry.actorEmail ? ` · ${entry.actorEmail}` : ""}
                </li>
              ))}
            </ol>
          </section>
        )}
      </>
    );
  }
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin/products">← {text("Продукти", "Products")}</Link>
          <p className="eyebrow">{text("КАТАЛОГ", "CATALOG")}</p>
          <h1>{title}</h1>
        </section>
        {content}
      </main>
      <SiteFooter />
    </>
  );
}
