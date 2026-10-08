import Image from "next/image";
import Link from "next/link";
import type { Product } from "../lib/catalog";
import { availableStock } from "../lib/inventory";
import Icon from "./icon";

export default function ProductCard({ product }: { product: Product }) {
  const available = availableStock(product.stock) > 0;
  return (
    <article className="product-card">
      <Link
        href={`/catalog/${product.sku}`}
        className="product-photo"
        aria-label={`Разгледай ${product.name}`}
      >
        <Image
          src={product.image}
          alt={`Илюстрация: ${product.name}`}
          fill
          sizes="(max-width: 600px) 100vw, (max-width: 900px) 50vw, 33vw"
        />
        <span className="product-demo-tag">ДЕМО</span>
        <span className="photo-arrow">
          <Icon name="arrow" />
        </span>
      </Link>
      <div className="product-info">
        <p className="product-category">{product.category}</p>
        <h2 className="product-title">
          <Link href={`/catalog/${product.sku}`}>{product.name}</Link>
        </h2>
        <p className="product-description">{product.description}</p>
        <div className="product-bottom">
          <span className={available ? "stock-available" : "stock-unavailable"}>
            <i />
            {available ? "Примерна наличност" : "Няма свободни бройки"}
          </span>
          <span className="product-code">{product.sku}</span>
        </div>
      </div>
    </article>
  );
}
