import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Fails on serious or critical WCAG 2.1 AA violations in the current state. */
async function expectNoSeriousViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
  ]);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const serious = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(
    serious.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(" ")).slice(0, 5),
    })),
  ).toEqual([]);
}

async function addToCart(page: Page) {
  await page.goto("/catalog/DEMO-003");
  await page
    .getByRole("button", { name: "Добави в демо количката" })
    .first()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Добавено." }),
  ).toBeVisible();
}

async function fillCheckout(page: Page, phone: string) {
  await page.goto("/checkout");
  await page
    .getByRole("textbox", { name: "Име и фамилия" })
    .fill("Иван Петров");
  await page
    .getByRole("textbox", { name: "Имейл", exact: true })
    .fill("e2e@example.test");
  await page.getByRole("textbox", { name: "Телефон" }).fill(phone);
  await page.getByRole("radio", { name: "До адрес" }).check();
  await page.getByRole("textbox", { name: /Населено място/i }).fill("София");
  await page.getByRole("textbox", { name: /Пощенски код/i }).fill("1000");
  await page.getByRole("textbox", { name: /Улица/i }).fill("ул. Тестова");
  await page.getByRole("textbox", { name: /Номер/i }).fill("1");
  await page.getByRole("button", { name: "Преглед на демо поръчката" }).click();
}

for (const path of [
  "/",
  "/catalog",
  "/catalog/DEMO-003",
  "/cart",
  "/checkout",
  "/promotions",
  "/account",
  "/garage",
  "/favorites",
]) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoSeriousViolations(page);
  });
}

test.describe("interactive states", () => {
  test("checkout with a validation error", async ({ page }) => {
    await addToCart(page);
    await fillCheckout(page, "12345");
    await expect(
      page.getByRole("alert").filter({ hasText: "телефон" }),
    ).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("checkout with a preview", async ({ page }) => {
    await addToCart(page);
    await fillCheckout(page, "0888 123 456");
    await expect(
      page.getByRole("region", { name: "Преглед на демо поръчката" }),
    ).toContainText("Данните са проверени.");
    await expectNoSeriousViolations(page);
  });

  test("open catalog filters", async ({ page }) => {
    await page.goto("/catalog");
    const toggle = page.getByRole("button", { name: /^Филтри/ });
    // A drawer only on small screens; on desktop the filters are always shown.
    if (await toggle.isVisible()) {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }
    await expectNoSeriousViolations(page);
  });

  test("open quick view dialog", async ({ page }) => {
    await page.goto("/catalog");
    await page
      .getByRole("button", { name: /^Бърз преглед: / })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("account registration form", async ({ page }) => {
    await page.goto("/account");
    await page.getByRole("button", { name: "Регистрация" }).click();
    await expect(
      page.getByRole("button", { name: "Регистрация" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expectNoSeriousViolations(page);
  });
});

test("the favourite toggle has one fixed name and reports its state", async ({
  page,
}) => {
  await page.goto("/catalog/DEMO-003");
  // The visible label starts the accessible name (WCAG 2.5.3); the state is
  // announced once, by aria-pressed, not repeated in the name.
  const toggle = page.getByRole("button", {
    name: "Любими: Въздушен филтър",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle).toContainText("Любими");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Любими: Въздушен филтър", exact: true }),
  ).toHaveCount(1);
  await page.goto("/catalog/DEMO-003?lang=en");
  await expect(
    page.getByRole("button", { name: "Favorites: Air filter", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("promotion prices state the discount as text", async ({ page }) => {
  await page.goto("/promotions");
  // The photo badge sits in a link hidden from assistive technology; the
  // price block says it again for everyone.
  const discount = page.locator(".discount-percent").first();
  await expect(discount).toBeVisible();
  await expect(discount).toHaveText(/^Отстъпка −\d+%$/);
});
