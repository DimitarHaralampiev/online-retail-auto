import Link from "next/link";
import { currentAdmin } from "../../../lib/admin-product-http";
import { requestLocale } from "../../../lib/i18n/server";
import { adminReturns } from "../../../lib/returns";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import ReturnsAdmin from "../../../components/returns-admin";

export default async function AdminReturnsPage() {
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const admin = await currentAdmin();
  const rows = admin ? await adminReturns() : null;
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin">← {text("Администрация", "Administration")}</Link>
          <p className="eyebrow">{text("ПОРЪЧКИ", "ORDERS")}</p>
          <h1>{text("Връщания", "Returns")}</h1>
          <p>
            {text(
              "Заявки за отказ от доставени поръчки (14 дни от доставката). Получената стока се връща в склада; сумата за възстановяване се отбелязва към заявката.",
              "Withdrawal requests for delivered orders (14 days from delivery). Received goods go back into stock; the amount to refund is recorded on the request.",
            )}
          </p>
        </section>
        {rows ? (
          <ReturnsAdmin rows={rows} />
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
