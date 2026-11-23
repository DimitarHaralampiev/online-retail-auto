import Localize from "./localize";
import Link from "next/link";
import { Brand } from "./site-header";
import Icon from "./icon";
import { ConsentSettingsButton } from "./consent-provider";
import NewsletterForm from "./newsletter-form";
import { companyDetails, LEGAL_SLUGS, LEGAL_TITLES } from "../lib/legal-shared";

export default function SiteFooter() {
  // Configured trader details only (COMPANY_* settings).
  const company = companyDetails()
    .filter((f) => ["Търговец", "ЕИК"].includes(f.label[0]))
    .map((f) => (f.label[0] === "ЕИК" ? `ЕИК ${f.value}` : f.value))
    .join(" · ");
  return (
    <Localize>
      {
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
              <Link href="/for-you">
                За теб <Icon name="arrow" />
              </Link>
              <Link href="/promotions">
                Промоции <Icon name="arrow" />
              </Link>
            </div>
            <nav className="footer-links" aria-label="Информация за пазаруване">
              <span className="eyebrow">ИНФОРМАЦИЯ</span>
              {LEGAL_SLUGS.map((slug) => (
                <Link key={slug} href={`/legal/${slug}`}>
                  {LEGAL_TITLES[slug][0]}
                </Link>
              ))}
              <ConsentSettingsButton />
            </nav>
            <NewsletterForm />
            <div className="footer-note">
              <span className="eyebrow">СЛЕДВАЩАТА СТЪПКА</span>
              <p>Подготвяме магазин със собствена наличност в България.</p>
              <span className="opening-status">
                <i /> Скоро на пътя
              </span>
            </div>
          </div>
          <div className="site-width footer-bottom">
            {company && <span>{company}</span>}
            <span>
              © {new Date().getFullYear()} AUTO/SHOP · Временна визуална
              идентичност
            </span>
            <span>Демо версия · Все още не приемаме поръчки</span>
          </div>
        </footer>
      }
    </Localize>
  );
}
