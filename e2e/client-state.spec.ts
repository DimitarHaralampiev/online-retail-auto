// Client state kept outside React (#59): guest favourites and the cart in
// browser storage, and the checkout office list. Storage flows are checked
// with working storage and with storage the browser refuses.
import { expect, test, type Page } from "@playwright/test";

const product = "Въздушен филтър";

async function addToCart(page: Page, sku = "DEMO-003") {
  await page.goto(`/catalog/${sku}`);
  await page
    .getByRole("button", { name: "Добави в демо количката" })
    .first()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Добавено." }),
  ).toBeVisible();
}

/** Follows a header link without reloading (on mobile, via the menu). */
async function navigate(page: Page, name: string) {
  const toggle = page.getByRole("button", { name: "Отвори менюто" });
  if (await toggle.isVisible()) await toggle.click();
  await page
    .getByRole("navigation", { name: "Основна навигация" })
    .getByRole("link", { name, exact: true })
    .click();
}

const favoriteButton = (page: Page) =>
  page.getByRole("button", { name: `Любими: ${product}`, exact: true });

test("guest favourites survive a reload and show on the favourites page", async ({
  page,
}) => {
  await page.goto("/catalog/DEMO-003");
  await expect(favoriteButton(page)).toHaveAttribute("aria-pressed", "false");
  await favoriteButton(page).click();
  await expect(favoriteButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(favoriteButton(page)).toHaveAttribute("aria-pressed", "true");
  await navigate(page, "Любими");
  await expect(page.getByRole("main")).toContainText(product);
});

test("guest favourites follow in another tab", async ({ page, context }) => {
  await page.goto("/catalog/DEMO-003");
  const other = await context.newPage();
  await other.goto("/catalog/DEMO-003");
  await expect(favoriteButton(other)).toBeEnabled();
  await favoriteButton(page).click();
  // Through the storage event, without reloading the other tab.
  await expect(favoriteButton(other)).toHaveAttribute("aria-pressed", "true");
  await favoriteButton(page).click();
  await expect(favoriteButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(favoriteButton(other)).toHaveAttribute("aria-pressed", "false");
});

test.describe("when the browser refuses storage", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Blocked", "SecurityError");
      };
    });
  });

  test("favourites still work for the page and say they are not saved", async ({
    page,
  }) => {
    await page.goto("/catalog/DEMO-003");
    await favoriteButton(page).click();
    await expect(favoriteButton(page)).toHaveAttribute("aria-pressed", "true");
    // Kept in memory: the favourites page (reached without a reload) shows
    // the product and says the browser does not keep it.
    await navigate(page, "Любими");
    await expect(page).toHaveURL(/\/favorites$/);
    await expect(page.getByRole("main")).toContainText(product);
    await expect(
      page.getByText(
        "Любимите работят, но браузърът не позволява запазването им.",
      ),
    ).toBeVisible();
  });

  test("the cart still works and warns that it will not survive a reload", async ({
    page,
  }) => {
    await addToCart(page);
    // Without a reload: the cart lives only in memory here.
    await page.getByRole("link", { name: /^Количка: 1 броя/ }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole("main")).toContainText(product);
    await expect(
      page.getByText(
        "Браузърът не позволява запазване на количката. Тя работи само до презареждане.",
      ),
    ).toBeVisible();
  });
});

test("checkout loads the offices of the chosen courier", async ({ page }) => {
  await addToCart(page);
  await page.goto("/checkout");
  await expect(page.getByRole("radio", { name: "До офис" })).toBeChecked();
  const city = page.getByRole("combobox", { name: "Град" });
  await expect(city).toBeEnabled();
  await city.selectOption("Пловдив");
  const office = page.getByRole("combobox", { name: "Офис" });
  await expect(
    office.getByRole("option", { name: "Тестов офис — Пловдив, Център" }),
  ).toBeAttached();
  await page.getByRole("radio", { name: "Еконт" }).check();
  await expect(city).toBeEnabled();
  await city.selectOption("Варна");
  await expect(
    office.getByRole("option", { name: "Тестов офис — Варна, Изток" }),
  ).toBeAttached();
  await expect(page.getByText("Офис на Еконт")).toBeVisible();
});
