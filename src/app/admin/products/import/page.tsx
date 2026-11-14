import Link from "next/link";
import { currentAdmin } from "../../../../lib/admin-product-http";
import { IMPORT_COLUMNS } from "../../../../lib/product-import";
import { requestLocale } from "../../../../lib/i18n/server";
import SiteHeader from "../../../../components/site-header";
import SiteFooter from "../../../../components/site-footer";
import ProductImport from "../../../../components/product-import";

export default async function ProductImportPage() {
  const en = (await requestLocale()) === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const admin = await currentAdmin();
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width inventory-page">
        <section className="page-intro">
          <Link href="/admin/products">← {text("Продукти", "Products")}</Link>
          <p className="eyebrow">{text("КАТАЛОГ", "CATALOG")}</p>
          <h1>{text("Импорт от CSV", "CSV import")}</h1>
          <p>
            {text(
              "Първо провери файла: ще видиш какво ще стане с всеки ред. Импортът се прилага само ако няма грешки — всичко или нищо.",
              "Check the file first to see what each row will do. The import is applied only when there are no errors — all or nothing.",
            )}
          </p>
        </section>
        {admin ? (
          <>
            <section className="checkout-panel">
              <h2>{text("Колони", "Columns")}</h2>
              <p>
                <code>{IMPORT_COLUMNS.join(";")}</code>
              </p>
              <ul>
                <li>
                  {text(
                    "Разделител „;“ или „,“; кодиране UTF-8; до 2 MB и 2000 реда на файл. Задължителна е само колоната sku; за нов продукт и name_bg.",
                    "Delimiter “;” or “,”; UTF-8 encoding; up to 2 MB and 2000 rows per file. Only sku is required, plus name_bg for new products.",
                  )}
                </li>
                <li>
                  {text(
                    "Празна клетка запазва текущата стойност на съществуващ продукт.",
                    "An empty cell keeps an existing product's current value.",
                  )}
                </li>
                <li>
                  {text(
                    "category е адресът на категорията (напр. parts-consumables); price и unit_cost са в евро с ДДС / без ДДС; vat е процент; status е draft, published или archived.",
                    "category is the category address (e.g. parts-consumables); price and unit_cost are in euros incl. / excl. VAT; vat is a percentage; status is draft, published or archived.",
                  )}
                </li>
                <li>
                  {text(
                    "stock задава начална наличност само за нови продукти; после наличността се променя чрез фактури и поръчки.",
                    "stock sets opening stock for new products only; afterwards stock changes through invoices and orders.",
                  )}
                </li>
              </ul>
            </section>
            <ProductImport />
          </>
        ) : (
          <p>
            <Link href="/account">
              {text(
                "Влез с администраторски профил.",
                "Sign in with an administrator account.",
              )}
            </Link>
          </p>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
