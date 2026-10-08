import Link from "next/link";
import Catalog from "../../components/catalog";

export default function CatalogPage() {
  return (
    <main>
      <header className="header"><Link className="brand" href="/">AUTO<span>/</span>SHOP</Link><Link href="/inventory-demo">Демо склад</Link></header>
      <section className="page-intro"><p className="eyebrow">КАТАЛОГ</p><h1>За твоя автомобил.</h1><p className="demo-notice">Демонстрация с измислени продукти и наличности. Все още няма продажни цени и поръчки.</p></section>
      <section className="categories" aria-label="Продукти"><Catalog /></section>
    </main>
  );
}
