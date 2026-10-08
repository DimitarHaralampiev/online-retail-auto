import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import Checkout from "../../components/checkout";

export default function CheckoutPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width checkout-page">
        <section className="page-intro">
          <p className="eyebrow">02 / ДОСТАВКА И ПЛАЩАНЕ</p>
          <h1>
            СЛЕДВАЩАТА СТЪПКА.
            <br />
            <span>ПО ТВОЯ НАЧИН.</span>
          </h1>
          <p className="demo-notice">
            Пробвай с тестови данни. Офисите и цените са примерни. Не създаваме
            реална поръчка, товарителница или плащане.
          </p>
        </section>
        <Checkout />
      </main>
      <SiteFooter />
    </>
  );
}
