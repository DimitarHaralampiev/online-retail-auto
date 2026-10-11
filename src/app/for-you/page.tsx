import Link from "next/link";
import SiteHeader from "../../components/site-header";
import SiteFooter from "../../components/site-footer";
export const metadata = { title: "За теб — AUTO/SHOP" };
const services = [
  {
    number: "01",
    title: "Любимите ти. Запазени.",
    description:
      "Събери добрите находки на едно място. Без профил ги пазим в този браузър; след вход ги добавяме към твоя профил.",
    label: "Виж любимите",
    href: "/favorites",
    tag: "Винаги достъпно",
  },
  {
    number: "02",
    title: "Твоята цена. В точния момент.",
    description:
      "Разреши имейли за намаления и избери кои любими продукти да следиш. Ще ти пишем, когато цената им падне.",
    label: "Избери известията",
    href: "/account#services",
    tag: "По твой избор",
  },
  {
    number: "03",
    title: "Обратно на рафта.",
    description:
      "Няма наличност? Заяви известие за конкретния продукт. Получаваш еднократен имейл, когато отново има свободни бройки.",
    label: "Разгледай каталога",
    href: "/catalog",
    tag: "По твой избор",
  },
  {
    number: "04",
    title: "Моят гараж.",
    description:
      "Запази марка, модел, година и двигател. Избери автомобил за филтъра в каталога — той показва само продукти с въведена и проверена съвместимост.",
    label: "Добави автомобил",
    href: "/garage",
    tag: "С твоя профил",
  },
  {
    number: "05",
    title: "Помним следващата смяна.",
    description:
      "Запиши последната смяна на масло, филтри или друго обслужване и задай следваща дата. Разреши сервизните имейли, за да получиш напомняне.",
    label: "Създай напомняне",
    href: "/garage",
    tag: "По твой избор",
  },
  {
    number: "06",
    title: "Пак същото? Лесно.",
    description:
      "От „Моите поръчки“ добави продуктите от предишна покупка в количката. Проверяваме днешните цени и наличности, а ти преглеждаш покупката преди поръчване.",
    label: "Моите поръчки",
    href: "/account",
    tag: "С твоя профил",
  },
];
export default function ForYouPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="site-width benefits-page">
        <section className="page-intro benefits-intro">
          <p className="eyebrow">МАЛКИТЕ УДОБСТВА. ГОЛЯМАТА РАЗЛИКА.</p>
          <h1>
            ТВОЯТА КОЛА.
            <br />
            <span>ТВОИТЕ ПРАВИЛА.</span>
          </h1>
          <p>
            По-малко търсене. Повече време за пътя. Подреди своите продукти,
            автомобили и напомняния — точно както ти е удобно.
          </p>
          <Link className="button" href="/account">
            Създай своя профил
          </Link>
          <Link className="text-link" href="/account#services">
            Управлявай моите услуги →
          </Link>
        </section>
        <section className="benefits-grid" aria-label="Услуги за клиента">
          {services.map((s) => (
            <article className="benefit-card" key={s.number}>
              <div className="benefit-top">
                <span>{s.number}</span>
                <small>{s.tag}</small>
              </div>
              <h2>{s.title}</h2>
              <p>{s.description}</p>
              <Link className="text-link" href={s.href}>
                {s.label} →
              </Link>
            </article>
          ))}
        </section>
        <section className="benefits-control">
          <p className="eyebrow">ТИ ИЗБИРАШ КАКВО ПОЛУЧАВАШ</p>
          <h2>Три отметки. Пълен контрол.</h2>
          <p>
            При регистрация можеш да разрешиш имейли за намаления, наличности и
            сервизни напомняния. Всички са изключени по подразбиране. После
            избираш конкретните продукти и дати, а настройките променяш по всяко
            време от „Моите услуги“.
          </p>
          <p className="note">
            Писмата за потвърждение на профила и етапите на поръчките се
            изпращат отделно. В момента каталогът, плащанията и имейлите са в
            тестов режим. За демонстрационните части още няма въведена проверена
            съвместимост.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
