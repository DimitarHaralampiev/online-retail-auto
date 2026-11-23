import Link from "next/link";
import { currentAdmin } from "../../../lib/admin-product-http";
import { requestLocale } from "../../../lib/i18n/server";
import { reviewsForModeration } from "../../../lib/reviews";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import ReviewsAdmin from "../../../components/reviews-admin";

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).status;
  const status = raw === "published" || raw === "rejected" ? raw : "pending";
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const admin = await currentAdmin();
  const rows = admin ? await reviewsForModeration(status) : null;
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin">← {text("Администрация", "Administration")}</Link>
          <p className="eyebrow">{text("КАТАЛОГ", "CATALOG")}</p>
          <h1>{text("Отзиви", "Reviews")}</h1>
          <p>
            {text(
              "Отзиви от клиенти с доставена поръчка на продукта. Показват се само публикуваните; рейтингът се смята само от тях.",
              "Reviews from customers with a delivered order of the product. Only published ones are shown, and the rating is computed from them only.",
            )}
          </p>
        </section>
        {rows ? (
          <ReviewsAdmin rows={rows} status={status} />
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
