import { expect, test, type Page } from "@playwright/test";

const addToCart = "Добави в демо количката";

/** Adds the product on the current detail page and waits until it is saved. */
async function addCurrentProductToCart(page: Page) {
  await page.getByRole("button", { name: addToCart }).first().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Добавено." }),
  ).toBeVisible();
}

test("home page leads to the catalog", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "ТВОЯТ АВТОМОБИЛ. ТВОЯТ ХАРАКТЕР.",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Разгледай каталога" }).click();
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(
    page.getByRole("status").filter({ hasText: "продукта" }),
  ).toHaveText(/^\s*6\s*продукта\s*$/);
});

test("catalog filters by category, search and promotion", async ({
  page,
  isMobile,
}) => {
  const heading = (name: string) =>
    page.getByRole("heading", { level: 2, name });
  // On small screens the filters live behind a toggle.
  async function openCatalog() {
    await page.goto("/catalog");
    if (isMobile)
      await page.getByRole("button", { name: "Филтри", exact: true }).click();
  }

  await openCatalog();
  await page
    .getByRole("combobox", { name: "Категория", exact: true })
    .selectOption({ label: "Автокозметика (2)" });
  await expect(
    page.getByRole("status").filter({ hasText: "продукт" }),
  ).toHaveText(/^\s*2\s*продукта\s*$/);
  await expect(heading("Шампоан за автомобил")).toBeVisible();
  await expect(heading("Въздушен филтър")).toHaveCount(0);

  await openCatalog();
  await page
    .getByRole("searchbox", { name: "Търсене", exact: true })
    .fill("филтър");
  await expect(heading("Въздушен филтър")).toBeVisible();
  await expect(heading("Шампоан за автомобил")).toHaveCount(0);

  await openCatalog();
  await page.getByText("Само промоции").click();
  await expect(heading("Органайзер за багажник")).toBeVisible();
  await expect(heading("Въздушен филтър")).toHaveCount(0);
});

test("out-of-stock products cannot be added to the cart", async ({ page }) => {
  await page.goto("/catalog/DEMO-004");
  await expect(
    page.getByRole("button", { name: "Няма свободни бройки" }).first(),
  ).toBeDisabled();
});

test("cart keeps items and recalculates totals", async ({ page }) => {
  await page.goto("/catalog/DEMO-003");
  await expect(
    page.getByRole("heading", { level: 1, name: "Въздушен филтър" }),
  ).toBeVisible();
  await addCurrentProductToCart(page);
  await page.goto("/cart");
  const summary = page.getByRole("complementary", {
    name: "Обобщение на количката",
  });
  await expect(summary).toContainText("18,90 €");
  await page
    .getByRole("combobox", { name: "Бройки за Въздушен филтър" })
    .selectOption("2");
  await expect(summary).toContainText("37,80 €");
  await page.reload();
  await expect(summary).toContainText("37,80 €");
  await page.getByRole("button", { name: "Премахни Въздушен филтър" }).click();
  await expect(
    page.getByRole("region", { name: "Продукти в количката" }),
  ).toHaveCount(0);
});

test("checkout previews an address delivery with cash on delivery", async ({
  page,
}) => {
  await page.goto("/catalog/DEMO-003");
  await addCurrentProductToCart(page);
  await page.goto("/checkout");
  await page
    .getByRole("textbox", { name: "Име и фамилия" })
    .fill("Иван Петров");
  await page.getByRole("textbox", { name: "Имейл" }).fill("e2e@example.test");
  await page.getByRole("textbox", { name: "Телефон" }).fill("0888 123 456");
  await page.getByRole("radio", { name: "До адрес" }).check();
  await page.getByRole("textbox", { name: /Населено място/i }).fill("София");
  await page.getByRole("textbox", { name: /Пощенски код/i }).fill("1000");
  await page.getByRole("textbox", { name: /Улица/i }).fill("ул. Тестова");
  await page.getByRole("textbox", { name: /Номер/i }).fill("1");
  await expect(
    page.getByRole("radio", { name: "Наложен платеж" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Преглед на демо поръчката" }).click();
  const preview = page.getByRole("region", {
    name: "Преглед на демо поръчката",
  });
  await expect(preview).toContainText("Данните са проверени.");
  await expect(preview).toContainText("1000 София, ул. Тестова 1");
  // 18.90 EUR goods + 5.00 EUR test shipping.
  await expect(preview).toContainText("5,00 € тестова доставка · 23,90 € общо");
});

test("checkout rejects an invalid phone number", async ({ page }) => {
  await page.goto("/catalog/DEMO-003");
  await addCurrentProductToCart(page);
  await page.goto("/checkout");
  await page
    .getByRole("textbox", { name: "Име и фамилия" })
    .fill("Иван Петров");
  await page.getByRole("textbox", { name: "Имейл" }).fill("e2e@example.test");
  await page.getByRole("textbox", { name: "Телефон" }).fill("12345");
  await page.getByRole("radio", { name: "До адрес" }).check();
  await page.getByRole("textbox", { name: /Населено място/i }).fill("София");
  await page.getByRole("textbox", { name: /Пощенски код/i }).fill("1000");
  await page.getByRole("textbox", { name: /Улица/i }).fill("ул. Тестова");
  await page.getByRole("textbox", { name: /Номер/i }).fill("1");
  await page.getByRole("button", { name: "Преглед на демо поръчката" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "телефон" }),
  ).toHaveText("Попълни валиден български телефон.");
  await expect(
    page.getByRole("region", { name: "Преглед на демо поръчката" }),
  ).toHaveCount(0);
});

test("the store switches to English and remembers it", async ({ page }) => {
  const english = page.getByRole("heading", {
    level: 1,
    name: "THE RIGHT CHOICE. DOWN TO THE LAST DETAIL.",
  });
  await page.goto("/catalog");
  await page.getByRole("button", { name: "English" }).click();
  await expect(english).toBeVisible();
  await expect(page.getByRole("button", { name: "English" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(english).toBeVisible();
});

test("each product card exposes one link and the logo names the home page", async ({
  page,
}) => {
  await page.goto("/catalog");
  await expect(
    page
      .getByRole("banner")
      .getByRole("link", { name: /AUTO\/SHOP.*Начална страница/ }),
  ).toHaveAttribute("href", "/");
  // The photo duplicates the title link and is hidden from assistive
  // technology, so each card exposes exactly one link to its product.
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Органайзер за багажник" }),
  });
  await expect(
    card.getByRole("link").and(card.locator('[href="/catalog/DEMO-001"]')),
  ).toHaveCount(1);
});

test("switching language does not reload client state from storage", async ({
  page,
}) => {
  await page.goto("/catalog/DEMO-003");
  await addCurrentProductToCart(page);
  await expect(
    page.getByRole("link", { name: "Количка: 1 броя" }),
  ).toBeVisible();
  // Change storage behind the app's back: only a re-run of the cart's
  // hydration effect would pick this up.
  await page.evaluate(() =>
    localStorage.setItem(
      "auto-shop:cart:v1",
      JSON.stringify({ version: 1, items: [{ sku: "DEMO-003", quantity: 3 }] }),
    ),
  );
  await page.getByRole("button", { name: /English/ }).click();
  // The switch sets <html lang> on the client, then router.refresh() fetches
  // new layout props; wait until that request has finished.
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "Cart: 1 items" })).toBeVisible();
});

test.describe("catalog state lives in the URL", () => {
  const heading = (page: Page, name: string) =>
    page.getByRole("heading", { level: 2, name });
  const count = (page: Page) =>
    page.getByRole("status").filter({ hasText: "продукт" });

  test("filters are shareable, survive reload and follow back navigation", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/catalog");
    if (isMobile)
      await page.getByRole("button", { name: "Филтри", exact: true }).click();
    await page.getByText("Само промоции").click();
    await expect(page).toHaveURL(/[?&]promotions=1/);
    await page
      .getByRole("combobox", { name: "Подреди" })
      .selectOption("price-desc");
    await expect(page).toHaveURL(/sort=price-desc/);
    await page.reload();
    await expect(count(page)).toHaveText(/^\s*3\s*продукта\s*$/);
    await page.goBack();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page).toHaveURL(/promotions=1/);
  });

  test("a deep link applies filters and sorting on the server", async ({
    page,
  }) => {
    await page.goto("/catalog?promotions=1&sort=price-desc");
    await expect(count(page)).toHaveText(/^\s*3\s*продукта\s*$/);
    const names = page.locator(".product-grid .product-title");
    await expect(names).toHaveText([
      "Органайзер за багажник",
      "Стойка за телефон",
      "Шампоан за автомобил",
    ]);
  });

  test("a page past the end offers a way back", async ({ page }) => {
    await page.goto("/catalog?page=5");
    await expect(
      page.getByRole("heading", { level: 2, name: "Няма такава страница." }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Към първата страница" }).click();
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(heading(page, "Въздушен филтър")).toBeVisible();
  });

  test("an invalid price range in the URL shows the price error", async ({
    page,
  }) => {
    await page.goto("/catalog?min=20&max=5");
    // Explained next to the results, also when the filter drawer is closed.
    await expect(
      page.getByRole("heading", { name: "Ценовият диапазон е невалиден." }),
    ).toBeVisible();
    await expect(count(page)).toHaveText(/^\s*0\s*продукта\s*$/);
    await page.getByRole("button", { name: "Изчисти цената" }).click();
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(count(page)).toHaveText(/^\s*6\s*продукта\s*$/);
  });

  test("hostile parameters are ignored", async ({ page, isMobile }) => {
    const response = await page.goto(
      "/catalog?sort=DROP%20TABLE&page=abc&q=%25%27--&available=yes",
    );
    expect(response?.status()).toBe(200);
    // The toggle shows the active filter count, e.g. "Филтри (1)".
    if (isMobile) await page.getByRole("button", { name: /^Филтри/ }).click();
    await expect(
      page.getByRole("searchbox", { name: "Търсене", exact: true }),
    ).toHaveValue("%'--");
    await expect(count(page)).toHaveText(/^\s*0\s*продукта\s*$/);
  });
});

test.describe("catalog filters chosen in quick succession", () => {
  test("typing and then ticking a filter keeps both", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/catalog");
    if (isMobile) await page.getByRole("button", { name: /^Филтри/ }).click();
    const search = page.getByRole("searchbox", {
      name: "Търсене",
      exact: true,
    });
    await search.pressSequentially("кърпа", { delay: 20 });
    // Before the typing pause elapses.
    await page.getByText("Само налични").click();
    await expect(page).toHaveURL(/available=1/);
    await expect(page).toHaveURL(/q=%D0%BA%D1%8A%D1%80%D0%BF%D0%B0/);
    await expect(search).toHaveValue("кърпа");
    // The microfiber cloth has no free stock, so nothing matches both.
    await expect(
      page.getByRole("status").filter({ hasText: "продукт" }),
    ).toHaveText(/^\s*0\s*продукта\s*$/);
  });

  test("a vehicle filter without a signed-in vehicle is ignored and dropped from links", async ({
    page,
  }) => {
    await page.goto("/catalog?car=1&sort=name");
    await expect(
      page.getByRole("status").filter({ hasText: "продукт" }),
    ).toHaveText(/^\s*6\s*продукта\s*$/);
    await expect(
      page.getByRole("button", { name: /Моят автомобил/ }),
    ).toHaveCount(0);
    await page.goto("/catalog?car=1&page=1&category=%D0%9D%D1%8F%D0%BC%D0%B0");
    // Unknown category is ignored too.
    await expect(
      page.getByRole("status").filter({ hasText: "продукт" }),
    ).toHaveText(/^\s*6\s*продукта\s*$/);
  });
});

test("pages do not ship the product catalog to the browser", async ({
  request,
}) => {
  // The empty cart and account pages show no products; their HTML and
  // embedded server data must not contain the catalog either.
  // Positive control: a page that lists products does contain them.
  expect(await (await request.get("/catalog")).text()).toContain(
    "Микрофибърна кърпа",
  );
  for (const path of ["/cart", "/account"]) {
    const html = await (await request.get(path)).text();
    for (const leaked of [
      "Микрофибърна кърпа",
      "DEMO-006",
      "Шампоан за автомобил",
    ])
      expect(html, `${path} contains ${leaked}`).not.toContain(leaked);
  }
});
