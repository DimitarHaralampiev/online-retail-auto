import Link from "next/link";
import { currentCustomer } from "../../lib/accounts";
import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import Localize from "../../components/localize";

export default async function AdminPage() {
  const customer = await currentCustomer();
  return (
    <Localize>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <p className="eyebrow">УПРАВЛЕНИЕ</p>
          <h1>Администрация</h1>
          <p>Фактури, наличности, поръчки и настройки на магазина.</p>
        </section>
        {customer?.isAdmin ? (
          <div className="admin-dashboard">
            <Link href="/admin/products" className="checkout-panel">
              <h2>Продукти и медия</h2>
              <p>
                Качи снимки и видеа, подреди галерията и избери основна снимка.
              </p>
              <span className="text-link">Отвори продуктовите галерии →</span>
            </Link>
            <Link href="/admin/insights" className="checkout-panel">
              <h2>Аналитика / ИИ</h2>
              <p>Задай въпрос за наличности, поръчки и зареждане.</p>
              <span className="text-link">Отвори аналитиката →</span>
            </Link>
            <Link href="/admin/invoices" className="checkout-panel">
              <h2>Фактури и склад</h2>
              <p>
                Качи PDF фактура, провери артикулите и заприходи доставката.
                Прегледай наличностите и предложенията за цени.
              </p>
              <span className="text-link">Отвори фактурите →</span>
            </Link>
            <Link
              href="/admin/invoices#warehouse-stock"
              className="checkout-panel"
            >
              <h2>Складови наличности</h2>
              <p>
                Налични количества и стойност на придобиване на заприходените
                артикули.
              </p>
              <span className="text-link">Отвори склада →</span>
            </Link>
            <Link href="/admin/orders" className="checkout-panel">
              <h2>Поръчки</h2>
              <p>
                Прегледай поръчките, плащанията и етапите до предаване на
                куриер.
              </p>
              <span className="text-link">Отвори поръчките →</span>
            </Link>
            <Link href="/admin/settings" className="checkout-panel">
              <h2>Настройки на доставката</h2>
              <p>
                Определи прага за безплатна доставка и тестовите куриерски
                такси.
              </p>
              <span className="text-link">Отвори настройките →</span>
            </Link>
          </div>
        ) : (
          <section className="checkout-panel">
            <h2>Само за администратори</h2>
            <p>Влез с потвърден профил, който има администраторски достъп.</p>
            <Link href="/account" className="button">
              Към профила
            </Link>
          </section>
        )}
      </main>
      <SiteFooter />
    </Localize>
  );
}
