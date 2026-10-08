import Link from "next/link";
import InventoryDemo from "../../components/inventory-demo";

export default function InventoryDemoPage() {
  return (
    <main>
      <header className="header"><Link className="brand" href="/">AUTO<span>/</span>SHOP</Link><Link href="/catalog">Каталог</Link></header>
      <section className="page-intro"><p className="eyebrow">ОСНОВА НА СКЛАДА</p><h1>Наличности и движения.</h1><p className="demo-notice">Публична демонстрация с измислени данни. Промените са само в тази страница и се губят при презареждане. Това не е административен панел.</p></section>
      <InventoryDemo />
    </main>
  );
}
