import type { Product } from "../lib/catalog";
import { formatMoney } from "../lib/cart";
import { getPromotion, sellingPrice } from "../lib/pricing";

export default function ProductPrice({ product }: { product: Product }) {
  const promotion = getPromotion(product);
  return (
    <div className="product-pricing">
      {promotion && (
        <div className="previous-price">
          <span>Стара демо цена</span>{" "}
          <del>{formatMoney(promotion.regularCents)}</del>
        </div>
      )}
      <p className="demo-product-price">
        <strong>{formatMoney(sellingPrice(product))}</strong>{" "}
        <small>{promotion ? "промо демо цена" : "примерна цена"}</small>
      </p>
      {promotion && (
        <p className="promotion-saving">
          Спестяваш {formatMoney(promotion.savingsCents)} в демонстрацията
        </p>
      )}
    </div>
  );
}
