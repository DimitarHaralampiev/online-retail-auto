import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import Cart from "../../components/cart";

export default function CartPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width checkout-page">
        <section className="page-intro">
          <p className="eyebrow">01 / ТВОЯТА КОЛИЧКА</p>
          <h1>
            ДЕТАЙЛИТЕ.
            <br />
            <span>КОИТО ИЗБРА.</span>
          </h1>
          <p className="demo-notice">
            Демо количка · Примерни цени в EUR. Все още не приемаме поръчки.
          </p>
        </section>
        <Cart />
      </main>
      <SiteFooter />
    </>
  );
}
