import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import Garage from "../../components/garage";
export const metadata = { title: "Моят гараж — AUTO/SHOP" };
export default function GaragePage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width catalog-page">
        <section className="page-intro">
          <p className="eyebrow">ТВОИТЕ АВТОМОБИЛИ</p>
          <h1>
            МОЯТ
            <br />
            <span>ГАРАЖ.</span>
          </h1>
          <p>Детайлите за колата и следващото обслужване — на едно място.</p>
        </section>
        <Garage />
      </main>
      <SiteFooter />
    </>
  );
}
