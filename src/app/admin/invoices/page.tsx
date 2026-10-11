import Link from "next/link";
import SiteHeader from "../../../components/site-header";
import SiteFooter from "../../../components/site-footer";
import InvoiceAdmin from "../../../components/invoice-admin";
import { currentCustomer } from "../../../lib/accounts";
export const metadata = { title: "Фактури и ИИ — AUTO/SHOP" };
export default async function InvoicesPage() {
  const customer = await currentCustomer();
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <nav className="customer-inline-actions">
          <Link href="/admin/orders">Поръчки →</Link>
          <Link href="/admin/invoices">Фактури / ИИ →</Link>
          <Link href="/admin/settings">Настройки на доставката →</Link>
        </nav>
        <section className="page-intro">
          <p className="eyebrow">УПРАВЛЕНИЕ / ФАКТУРИ И СКЛАД</p>
          <h1>
            ОТ ФАКТУРАТА.
            <br />
            <span>ДО ПРАВИЛНАТА ЦЕНА.</span>
          </h1>
          <p>
            Качи PDF, прегледай извлечените данни и потвърди складовата
            доставка.
          </p>
        </section>
        {customer?.isAdmin ? (
          <InvoiceAdmin />
        ) : (
          <div className="benefits-control">
            <h2>Само за администратори</h2>
            <p>Влез с потвърден профил, който има администраторски достъп.</p>
            <Link className="button" href="/account">
              Към профила
            </Link>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
