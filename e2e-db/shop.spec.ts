// Storefront flows that exist only with the PostgreSQL catalog (#122): the
// chosen car (#76, #94), brand facets (#76) and the signed-in customer.
import type { Page } from "@playwright/test";
import { expectNoSeriousViolations, expectNoSidewaysScroll } from "./axe";
import { expect, fixtures, signIn, test } from "./fixtures";

const count = (page: Page) =>
  page.getByRole("status").filter({ hasText: "продукт" });
const CAR = "Testmake Alpha Alpha I, 2014, 1.6 diesel";

async function openFilters(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: /^Филтри/ }).click();
}

test.describe("with a chosen car", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      { name: "auto_vehicle", value: fixtures().vehicle, url: baseURL! },
    ]);
  });

  test("the header shows the car and links to the selector", async ({
    page,
  }) => {
    await page.goto("/");
    const chip = page.getByRole("link", {
      name: `Моят автомобил: ${CAR} Смени`,
    });
    await expect(chip).toBeVisible();
    await expectNoSeriousViolations(page);
    await page.goto("/?lang=en");
    await expect(
      page.getByRole("link", { name: `My car: ${CAR} Change` }),
    ).toBeVisible();
    await page.goto("/?lang=bg");
    await chip.click();
    await expect(page).toHaveURL(/\/catalog#my-car$/);
    await expect(page.locator("#my-car")).toContainText(CAR);
  });

  test("the car filter keeps verified products and survives Back", async ({
    page,
    isMobile,
  }) => {
    await page.goto("/catalog");
    await openFilters(page, isMobile);
    const car = page.getByRole("checkbox", { name: "Само за моя автомобил" });
    await car.check();
    await expect(page).toHaveURL(/[?&]car=1/);
    await expect(count(page)).toHaveText(/^\s*1\s*продукта\s*$/);
    await expect(page.locator(".product-grid .product-title")).toHaveText([
      "Въздушен филтър",
    ]);
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(car).not.toBeChecked();
    await expect(count(page)).toHaveText(/^\s*6\s*продукта\s*$/);
  });
});

// Pages whose content exists only with the PostgreSQL catalog.
for (const [path, proof] of [
  ["/catalog", "Testbrand One"],
  ["/catalog/DEMO-003", "Testmake"],
  ["/cars", "Testmake"],
  ["/cars/testmake", "Alpha"],
  ["/cars/testmake/alpha", "Въздушен филтър"],
])
  test(`no serious accessibility violations on ${path}`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(path);
    if (path === "/catalog") await openFilters(page, isMobile);
    if (path === "/catalog/DEMO-003")
      await page.getByText("Съвместимост с автомобил", { exact: true }).click();
    await expect(page.getByRole("main").getByText(proof).first()).toBeVisible();
    await expectNoSeriousViolations(page);
    await expectNoSidewaysScroll(page);
  });

test("quick clicks on two brands keep both", async ({ page, isMobile }) => {
  await page.goto("/catalog");
  await openFilters(page, isMobile);
  // Both clicks before any answer: hold the navigations back for a moment.
  await page.route(
    (url) => url.searchParams.has("brand"),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    },
  );
  await page.getByRole("checkbox", { name: /^Testbrand One/ }).click();
  await page.getByRole("checkbox", { name: /^Testbrand Two/ }).click();
  await expect(page).toHaveURL(/brand=testbrand-one&brand=testbrand-two/);
  await expect(count(page)).toHaveText(/^\s*4\s*продукта\s*$/);
});

test("attribute filters narrow, show as chips and follow the URL", async ({
  page,
  isMobile,
}) => {
  await page.goto("/catalog");
  await openFilters(page, isMobile);
  const size = page.getByRole("group", { name: "Тестов размер" });
  // Natural order, with units and counts.
  await expect(size.getByRole("checkbox")).toHaveCount(2);
  await expect(size.locator("label")).toHaveText(["90 mm (1)", "450 mm (2)"]);
  await size.getByRole("checkbox", { name: /^450 mm/ }).check();
  await expect(page).toHaveURL(/attr=test-size%3A450/);
  await expect(count(page)).toHaveText(/^\s*2\s*продукта\s*$/);
  // The other value keeps its count (it can be added).
  await expect(size.locator("label")).toHaveText(["90 mm (1)", "450 mm (2)"]);
  await page
    .getByRole("group", { name: "Тестов цвят" })
    .getByRole("checkbox", { name: /^Син/ })
    .check();
  await expect(count(page)).toHaveText(/^\s*1\s*продукта\s*$/);
  await expectNoSeriousViolations(page);
  await expectNoSidewaysScroll(page);
  await page.reload();
  await expect(count(page)).toHaveText(/^\s*1\s*продукта\s*$/);
  await page.getByRole("button", { name: "Тестов цвят: Син ×" }).click();
  await expect(count(page)).toHaveText(/^\s*2\s*продукта\s*$/);
  await page.evaluate(() => history.back());
  await expect(count(page)).toHaveText(/^\s*1\s*продукта\s*$/);
  // English names; an unknown attribute in a link is ignored.
  await page.goto(
    "/catalog?lang=en&attr=test-size:450&attr=gone:1&attr=constructor:1",
  );
  await expect(
    page.getByRole("button", { name: "Test size: 450 mm ×" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /gone/ })).toHaveCount(0);
  await page.goto("/catalog?lang=bg");
});

test("the product page lists its attributes", async ({ page }) => {
  await page.goto("/catalog/DEMO-003");
  const specs = page.locator(".product-information-panels .product-specs");
  await expect(specs).toContainText("Тестов размер");
  await expect(specs).toContainText("450 mm");
});

test.describe("signed in", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, baseURL, fixtures().customer);
  });

  test("the account lists the customer's orders", async ({ page }) => {
    await page.goto("/account");
    const orders = page.locator(".my-orders");
    await expect(orders.getByRole("listitem").first()).toBeVisible();
    await expectNoSeriousViolations(page);
    await expectNoSidewaysScroll(page);
    // One of them, with its stages and lines.
    await orders.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Въздушен филтър").first()).toBeVisible();
    await expectNoSeriousViolations(page);
    await expectNoSidewaysScroll(page);
  });

  test("the checkout starts from the customer's details", async ({ page }) => {
    await page.goto("/catalog/DEMO-003");
    await page
      .getByRole("button", { name: "Добави в демо количката" })
      .first()
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Добавено." }),
    ).toBeVisible();
    await page.goto("/checkout");
    await expect(
      page.getByRole("textbox", { name: "Имейл", exact: true }),
    ).toHaveValue("buyer@example.test");
    await expect(
      page.getByRole("textbox", { name: "Име и фамилия" }),
    ).toHaveValue("Test Customer");
  });

  test("a favourite is kept with the account", async ({ page }) => {
    await page.goto("/catalog/DEMO-002");
    const toggle = page.locator(".favorite-button").first();
    await expect(toggle).toBeEnabled();
    const before = await toggle.getAttribute("aria-pressed");
    const after = before === "true" ? "false" : "true";
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", after);
    // Leave it as it was for the other project.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", before!);
  });
});
