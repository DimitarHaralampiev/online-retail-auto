import Localize from "../../../components/localize";
import Link from "next/link";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import AdminOrders from "../../../components/admin-orders";
export default function AdminOrdersPage() {
  return (
    <Localize>
      {
        <>
          <SiteHeader />
          <main id="main-content" className="site-width checkout-page">
            <nav className="customer-inline-actions">
              <Link href="/admin/orders">Поръчки →</Link>
              <Link href="/admin/invoices">Фактури / ИИ →</Link>
              <Link href="/admin/settings">Настройки на доставката →</Link>
            </nav>
            <section className="page-intro">
              <p className="eyebrow">УПРАВЛЕНИЕ / ПОРЪЧКИ</p>
              <h1>
                ОТ ПОЛУЧАВАНЕ.
                <br />
                <span>ДО ПРЕДАВАНЕ.</span>
              </h1>
            </section>
            <AdminOrders />
          </main>
          <SiteFooter />
        </>
      }
    </Localize>
  );
}
