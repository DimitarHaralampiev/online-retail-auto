import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
import Favorites from "../../components/favorites";
export default function FavoritesPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width catalog-page">
        <section className="page-intro">
          <p className="eyebrow">ТВОЯТА КОЛЕКЦИЯ</p>
          <h1>
            ДОБРИТЕ НАХОДКИ.
            <br />
            <span>НА ЕДНО МЯСТО.</span>
          </h1>
          <p>Запази любимите си продукти и следи това, което ти трябва.</p>
        </section>
        <Favorites />
      </main>
      <SiteFooter />
    </>
  );
}
