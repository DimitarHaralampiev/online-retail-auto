const categories = [
  { number: "01", title: "Автоаксесоари", description: "Практични решения за комфорт и грижа за автомобила." },
  { number: "02", title: "Части и консумативи", description: "Всичко необходимо за поддръжката на твоя автомобил." },
  { number: "03", title: "Автокозметика", description: "Продукти за почистване и защита отвътре и отвън." },
];

export default function Home() {
  return (
    <main>
      <header className="header">
        <a className="brand" href="/" aria-label="Начална страница">AUTO<span>/</span>SHOP</a>
        <span className="status">В разработка</span>
      </header>
      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">ЗА ТЕБ И ТВОЯ АВТОМОБИЛ</p>
        <h1 id="hero-title">Следващата стъпка.<br /><span>За всяко пътуване.</span></h1>
        <p className="intro">Подготвяме онлайн магазин за автоаксесоари и части със собствена складова наличност в България.</p>
        <a className="button" href="/catalog">Разгледай демо каталога <span aria-hidden="true">↗</span></a>
        <p className="note">Магазинът предстои да отвори. Поръчки все още не се приемат.</p>
      </section>
      <section id="categories" className="categories" aria-labelledby="categories-title">
        <div className="section-heading"><h2 id="categories-title">Какво подготвяме</h2><span>НАШИЯТ БЪДЕЩ КАТАЛОГ</span></div>
        <div className="grid">
          {categories.map((category) => (
            <article className="card" key={category.number}>
              <span className="number">{category.number}</span>
              <h3>{category.title}</h3>
              <p>{category.description}</p>
            </article>
          ))}
        </div>
      </section>
      <footer>Името и визуалната идентичност са временни. Създаваме магазина стъпка по стъпка.</footer>
    </main>
  );
}
