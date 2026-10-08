import Image from "next/image";
import Link from "next/link";
import type { Product } from "../lib/catalog";
import { availableStock } from "../lib/inventory";
import Icon from "./icon";
import AddToCart from "./add-to-cart";
import ProductPrice from "./product-price";
import { getPromotion } from "../lib/pricing";

export default function ProductCard({ product }: { product: Product }) {
  const available = availableStock(product.stock) > 0;
  const promotion = getPromotion(product);
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
        {promotion && (
          <span
            className="promotion-badge"
            aria-label={`Демо намаление ${promotion.discountPercent} процента`}
          >
            −{promotion.discountPercent}%
          </span>
        )}
        <span className="photo-arrow">
          <Icon name="arrow" />
        </span>
      </Link>
      <div className="product-info">
        <ProductPrice product={product} />
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
        <AddToCart product={product} />
      </div>
    </article>
  );
}
