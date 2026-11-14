import Link from "next/link";
import { redirect } from "next/navigation";
import { database } from "../../../lib/accounts";
import { currentAdmin } from "../../../lib/admin-product-http";
import {
  ADMIN_PAGE_SIZE,
  listAdminProducts,
  listQuerySchema,
} from "../../../lib/admin-products";
import { STATUS_LABELS } from "../../../lib/admin-product-shared";
import { formatMoney } from "../../../lib/cart";
import { requestLocale } from "../../../lib/i18n/server";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;
  // This address used to be the media gallery (?sku= selected a product).
  const legacySku = one("sku");
  if (legacySku)
    redirect(`/admin/products/media?sku=${encodeURIComponent(legacySku)}`);
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const admin = await currentAdmin();
  const parsed = listQuerySchema.safeParse({
    status: one("status") || undefined,
    q: one("q") || undefined,
    page: one("page") || undefined,
  });
  const query = parsed.success ? parsed.data : { page: 1 };
  const result = admin ? await listAdminProducts(database(), query) : null;
  const pages = result
    ? Math.max(1, Math.ceil(result.total / ADMIN_PAGE_SIZE))
    : 1;
  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    if (query.status) next.set("status", query.status);
    if (query.q) next.set("q", query.q);
    if (page > 1) next.set("page", String(page));
    const search = next.toString();
    return search ? `/admin/products?${search}` : "/admin/products";
  };
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin">← {text("Администрация", "Administration")}</Link>
          <p className="eyebrow">{text("КАТАЛОГ", "CATALOG")}</p>
          <h1>{text("Продукти", "Products")}</h1>
          <p>
            {text(
              "Създавай и редактирай продукти, публикувай ги в магазина или ги архивирай. Наличностите идват от заприходените фактури.",
              "Create and edit products, publish them to the shop or archive them. Stock comes from received invoices.",
            )}
          </p>
        </section>
        {!result ? (
          <p>
            <Link href="/account">
              {text(
                "Влез с администраторски профил.",
                "Sign in with an administrator account.",
              )}
            </Link>
          </p>
        ) : (
          <>
            <div className="admin-product-toolbar">
              <form
                method="get"
                action="/admin/products"
                className="admin-product-filters"
              >
                <label>
                  {text("Търсене по код или име", "Search by code or name")}
                  <input
                    type="search"
                    name="q"
                    defaultValue={query.q ?? ""}
                    maxLength={100}
                  />
                </label>
                <label>
                  {text("Статус", "Status")}
                  <select name="status" defaultValue={query.status ?? ""}>
                    <option value="">{text("Всички", "All")}</option>
                    {Object.entries(STATUS_LABELS).map(([value, [bg, eng]]) => (
                      <option key={value} value={value}>
                        {text(bg, eng)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="button">
                  {text("Филтрирай", "Filter")}
                </button>
              </form>
              <Link href="/admin/categories" className="button">
                {text("Категории", "Categories")}
              </Link>
              <Link href="/admin/products/edit" className="button">
                {text("Нов продукт", "New product")}
              </Link>
            </div>
            <p role="status">
              {text(`${result.total} продукта`, `${result.total} products`)}
            </p>
            {result.items.length > 0 && (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{text("Код", "SKU")}</th>
                      <th scope="col">{text("Име", "Name")}</th>
                      <th scope="col">{text("Статус", "Status")}</th>
                      <th scope="col">{text("Категория", "Category")}</th>
                      <th scope="col">{text("Цена", "Price")}</th>
                      <th scope="col">{text("Свободни", "Available")}</th>
                      <th scope="col">{text("Медия", "Media")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((product) => (
                      <tr key={product.sku}>
                        <td>{product.sku}</td>
                        <td>
                          <Link
                            href={`/admin/products/edit?sku=${encodeURIComponent(product.sku)}`}
                          >
                            {product.name}
                          </Link>
                        </td>
                        <td>
                          <span
                            className={`admin-product-status ${product.status}`}
                          >
                            {text(...STATUS_LABELS[product.status])}
                          </span>
                        </td>
                        <td>{product.categoryName ?? "—"}</td>
                        <td>
                          {product.priceCents === null
                            ? "—"
                            : formatMoney(product.priceCents)}
                        </td>
                        <td>{product.onHand - product.reserved}</td>
                        <td>
                          <Link
                            href={`/admin/products/media?sku=${encodeURIComponent(product.sku)}`}
                            aria-label={
                              text("Медия за ", "Media for ") + product.name
                            }
                          >
                            {text("Снимки", "Photos")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <nav
                className="catalog-pagination"
                aria-label={text("Страници", "Pages")}
              >
                {query.page > 1 && (
                  <Link href={pageHref(query.page - 1)}>
                    ← {text("Предишна", "Previous")}
                  </Link>
                )}
                <span>
                  {query.page} / {pages}
                </span>
                {query.page < pages && (
                  <Link href={pageHref(query.page + 1)}>
                    {text("Следваща", "Next")} →
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
