import Link from "next/link";
import { Brand } from "./site-header";
import Icon from "./icon";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-width footer-top">
        <div>
          <Brand />
          <p>
            Детайлите правят разликата.
            <br />
            По пътя. И извън него.
          </p>
        </div>
        <div className="footer-links">
          <span className="eyebrow">РАЗГЛЕДАЙ</span>
          <Link href="/catalog">
            Каталог <Icon name="arrow" />
          </Link>
          <Link href="/inventory-demo">
            Демо склад <Icon name="arrow" />
          </Link>
          <Link href="/promotions">
            Промоции <Icon name="arrow" />
          </Link>
        </div>
        <div className="footer-note">
          <span className="eyebrow">СЛЕДВАЩАТА СТЪПКА</span>
          <p>Подготвяме магазин със собствена наличност в България.</p>
          <span className="opening-status">
            <i /> Скоро на пътя
          </span>
        </div>
      </div>
      <div className="site-width footer-bottom">
        <span>
          © {new Date().getFullYear()} AUTO/SHOP · Временна визуална идентичност
        </span>
        <span>Демо версия · Все още не приемаме поръчки</span>
      </div>
    </footer>
  );
}
