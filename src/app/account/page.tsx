import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import Account from "../../components/account";
export default function AccountPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width checkout-page">
        <section className="page-intro">
          <p className="eyebrow">ТВОИТЕ ДАННИ / ТВОЯТ ИЗБОР</p>
          <h1>
            ЕДИН ПРОФИЛ.
            <br />
            <span>ПО-ЛЕСНА ПОРЪЧКА.</span>
          </h1>
          <p>Запази данните си за следващия път или поръчай като гост.</p>
        </section>
        <Account />
      </main>
      <SiteFooter />
    </>
  );
}
