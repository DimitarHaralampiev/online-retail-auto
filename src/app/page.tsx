import Image from "next/image";
import Link from "next/link";
import SiteHeader from "../components/site-header";
import SiteFooter from "../components/site-footer";
import Icon from "../components/icon";
import ProductCard from "../components/product-card";
import { demoProducts } from "../lib/catalog";

const categories = [
  {
    number: "01",
    title: "Автоаксесоари",
    line: "Твоят стил. Твоят комфорт.",
    image: "/images/organizer.png",
    label: "АКСЕСОАРИ",
  },
  {
    number: "02",
    title: "Части и консумативи",
    line: "Грижа, която има значение.",
    image: "/images/air-filter.png",
    label: "ЧАСТИ",
  },
  {
    number: "03",
    title: "Автокозметика",
    line: "Добрият вид е в детайлите.",
    image: "/images/car-shampoo.png",
    label: "ГРИЖА",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <section className="hero" aria-labelledby="hero-title">
          <Image
            className="hero-image"
            src="/images/garage-hero.png"
            alt="Графитен автомобил в гараж с топла светлина"
            fill
            priority
            sizes="100vw"
          />
          <div className="hero-shade" />
          <div className="site-width hero-content">
            <div className="hero-copy">
              <p className="eyebrow light">
                <span className="eyebrow-line" /> ЗА ХОРАТА, КОИТО ОБИЧАТ ДА
                КАРАТ
              </p>
              <h1 id="hero-title">
                ТВОЯТ АВТОМОБИЛ.
                <br />
                <span>ТВОЯТ ХАРАКТЕР.</span>
              </h1>
              <p className="hero-description">
                Части, аксесоари и грижа за всяко пътуване.
                <br />
                Защото доброто усещане започва от детайлите.
              </p>
              <Link className="button" href="/catalog">
                Разгледай каталога <Icon name="arrow" />
              </Link>
              <p className="hero-caption">
                ПОДГОТВЯМЕ НЕЩО ДОБРО. СКОРО НА ПЪТЯ.
              </p>
            </div>
            <div className="hero-coordinate" aria-hidden="true">
              <span>DRIVE WITH CHARACTER</span>
              <b>BG / 01</b>
            </div>
          </div>
          <div className="hero-bottom site-width">
            <span>
              PARTS <i /> ACCESSORIES <i /> CAR CARE
            </span>
            <a href="#categories">
              Открий повече <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>
        <div className="principles-strip">
          <div className="site-width">
            <span>
              <Icon name="box" />
              <strong>Собствен склад</strong>
              <small>Това е нашият план</small>
            </span>
            <span>
              <Icon name="tool" />
              <strong>За твоя автомобил</strong>
              <small>Части и аксесоари</small>
            </span>
            <span>
              <Icon name="spark" />
              <strong>До последния детайл</strong>
              <small>Грижа и автокозметика</small>
            </span>
          </div>
        </div>
        <section
          id="categories"
          className="section site-width"
          aria-labelledby="categories-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 / НАМЕРИ СВОЯТА ПОСОКА</p>
              <h2 id="categories-title">
                Всеки детайл.
                <br />
                <span className="muted-heading">На своето място.</span>
              </h2>
            </div>
            <p className="section-description">
              От практичното до личното.
              <br />
              Избери какво търсиш за автомобила си.
            </p>
          </div>
          <div className="category-grid">
            {categories.map((category) => (
              <Link
                className="category-card"
                href={{
                  pathname: "/catalog",
                  query: { category: category.title },
                }}
                key={category.number}
              >
                <div className="category-photo">
                  <Image
                    src={category.image}
                    alt=""
                    fill
                    sizes="(max-width: 700px) 100vw, 33vw"
                  />
                  <span className="category-number">/{category.number}</span>
                  <span className="category-word" aria-hidden="true">
                    {category.label}
                  </span>
                </div>
                <div className="category-info">
                  <div>
                    <h3>{category.title}</h3>
                    <p>{category.line}</p>
                  </div>
                  <span className="circle-arrow">
                    <Icon name="arrow" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
        <section className="featured-section" aria-labelledby="featured-title">
          <div className="site-width section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">02 / ПОГЛЕД В КАТАЛОГА</p>
                <h2 id="featured-title">
                  Малките неща.
                  <br />
                  <span className="muted-heading">Голямата разлика.</span>
                </h2>
              </div>
              <Link className="text-link" href="/catalog">
                Целият каталог <Icon name="arrow" />
              </Link>
            </div>
            <div className="product-grid">
              {[demoProducts[0], demoProducts[2], demoProducts[4]].map(
                (product) => (
                  <ProductCard key={product.sku} product={product} />
                ),
              )}
            </div>
            <p className="illustration-note">
              Илюстративни изображения · Примерни продукти и наличности
            </p>
          </div>
        </section>
        <section
          id="approach"
          className="approach-section"
          aria-labelledby="approach-title"
        >
          <div className="site-width approach-grid">
            <div>
              <p className="eyebrow light">03 / НАШИЯТ ПОДХОД</p>
              <h2 id="approach-title">
                ПОВЕЧЕ ОТ ЧАСТИ.
                <br />
                <span>ОТНОШЕНИЕ.</span>
              </h2>
              <p>
                Автомобилът е част от ежедневието ти. Подготвяме място, в което
                грижата за него ще бъде по-лесна, по-подредена и с внимание към
                всеки детайл.
              </p>
              <Link className="text-link light" href="/catalog">
                Разгледай демо каталога <Icon name="arrow" />
              </Link>
            </div>
            <div className="approach-art">
              <Image
                src="/images/microfiber.png"
                alt="Илюстрация на оранжева и графитна микрофибърна кърпа"
                fill
                sizes="(max-width: 700px) 100vw, 45vw"
              />
              <span>
                CARE IS A<br />
                <b>DETAIL.</b>
              </span>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
