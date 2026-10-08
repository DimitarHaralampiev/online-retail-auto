import Link from "next/link";
import { notFound } from "next/navigation";
import { demoProducts } from "../../../lib/catalog";
import { availableStock } from "../../../lib/inventory";

export function generateStaticParams() {
  return demoProducts.map(({ sku }) => ({ sku }));
}

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const product = demoProducts.find((item) => item.sku === sku);
  if (!product) notFound();
  return (
    <main>
      <header className="header"><Link className="brand" href="/">AUTO<span>/</span>SHOP</Link><Link href="/catalog">Към каталога</Link></header>
      <section className="page-intro">
        <p className="eyebrow">{product.category} · {product.sku}</p>
        <h1>{product.name}</h1><p className="intro">{product.description}</p>
        <p>{availableStock(product.stock) > 0 ? "Примерна наличност" : "Няма свободни бройки"}</p>
        <p className="demo-notice">Това е демонстрационен продукт. Цена, снимки и проверена съвместимост предстоят. Не се приемат поръчки.</p>
      </section>
    </main>
  );
}
