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
  // The server re-renders the root layout (it sets <html lang>) on refresh.
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: "Cart: 1 items" })).toBeVisible();
});
