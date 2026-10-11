import Link from "next/link";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import DeliverySettingsPanel from "../../../components/delivery-settings";
import { currentCustomer } from "../../../lib/accounts";
export const metadata = { title: "Настройки на доставката — AUTO/SHOP" };
export default async function SettingsPage() {
  const customer = await currentCustomer();
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width checkout-page">
        <section className="page-intro">
          <p className="eyebrow">УПРАВЛЕНИЕ / НАСТРОЙКИ</p>
          <h1>
            ДОСТАВКА.
            <br />
            <span>ПО ТВОИТЕ ПРАВИЛА.</span>
          </h1>
        </section>
        {customer?.isAdmin ? (
          <>
            <nav className="customer-inline-actions">
              <Link href="/admin/orders">Поръчки →</Link>
              <Link href="/admin/invoices">Фактури / ИИ →</Link>
            </nav>
            <DeliverySettingsPanel />
          </>
        ) : (
          <p>
            Влез с потвърден администраторски{" "}
            <Link href="/account">профил</Link>.
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
