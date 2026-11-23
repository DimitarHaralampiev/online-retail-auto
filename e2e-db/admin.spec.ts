// Accessibility of the admin pages with a signed-in administrator (#122).
import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousViolations, expectNoSidewaysScroll } from "./axe";
import { fixtures, signIn } from "./fixtures";

// Each page with something only a signed-in admin sees on it, so a scan of
// the "sign in" state can never pass for the real page.
const PAGES: [
  path: string,
  proof: (page: Page) => ReturnType<Page["locator"]>,
][] = [
  ["/admin", (p) => p.getByRole("link", { name: /Поръчки/ }).first()],
  ["/admin/orders", (p) => p.getByText("buyer@example.test").first()],
  ["/admin/products", (p) => p.getByRole("cell", { name: "DEMO-003" }).first()],
  [
    "/admin/products/edit",
    (p) => p.getByRole("button", { name: "Създай чернова" }),
  ],
  [
    "/admin/products/edit?sku=DEMO-003",
    (p) => p.getByRole("button", { name: "Запази промените" }),
  ],
  [
    "/admin/products/media?sku=DEMO-003",
    (p) => p.getByRole("button", { name: "Въздушен филтър" }).first(),
  ],
  ["/admin/products/import", (p) => p.getByLabel("CSV файл")],
  [
    "/admin/categories",
    (p) => p.getByRole("button", { name: "Нова категория" }),
  ],
  ["/admin/vehicles", (p) => p.getByText("Testmake").first()],
  ["/admin/legal", (p) => p.getByLabel("Текст на български")],
  ["/admin/returns", (p) => p.getByText("Поръчах грешен модел")],
  ["/admin/reviews", (p) => p.getByText("Пасна точно, качествен.")],
  ["/admin/invoices", (p) => p.locator('input[type="file"]').first()],
  ["/admin/settings", (p) => p.getByLabel(/Срок за картово плащане/)],
  ["/admin/insights", (p) => p.getByRole("textbox").last()],
];

test.beforeEach(async ({ context, baseURL }) => {
  await signIn(context, baseURL, fixtures().admin);
});

for (const [path, proof] of PAGES)
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(proof(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoSeriousViolations(page);
    await expectNoSidewaysScroll(page);
  });

test.describe("interactive states", () => {
  test("an order ready for handover with the legacy exception open", async ({
    page,
  }) => {
    await page.goto("/admin/orders");
    // The failed email and the refund owed by the received return.
    await expect(
      page.getByText(/Неизпратени след всички опити: 1/),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "За възстановяване" }),
    ).toBeVisible();
    await page
      .getByText(/Предаване без складово движение/)
      .first()
      .click();
    await expect(page.getByLabel("Причина").first()).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("a product form with a validation error", async ({ page }) => {
    await page.goto("/admin/products/edit?sku=DEMO-003");
    await page.getByLabel("Продажна цена с ДДС (EUR)").fill("безценно");
    await page.getByRole("button", { name: "Запази промените" }).click();
    await expect(page.locator(".error").first()).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("a new category form", async ({ page }) => {
    await page.goto("/admin/categories");
    await page.getByRole("button", { name: "Нова категория" }).click();
    await expect(
      page.getByRole("heading", { name: "Нова категория" }),
    ).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("a CSV check that finds errors", async ({ page }) => {
    await page.goto("/admin/vehicles");
    await page
      .getByLabel("CSV файл")
      .first()
      .setInputFiles({
        name: "vehicles.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "make;model;generation;year_from;year_to;engine;fuel\nTestmake;Gamma;Gamma I;нещо;;;\n",
        ),
      });
    await page.getByRole("button", { name: "Провери" }).first().click();
    await expect(
      page.getByText(/Има грешки — нищо не е променено/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Импортирай" }).first(),
    ).toBeDisabled();
    await expectNoSeriousViolations(page);
    await expectNoSidewaysScroll(page);
  });

  test("a legal text being edited", async ({ page }) => {
    await page.goto("/admin/legal");
    await page.getByRole("tab").nth(1).click();
    await page.getByLabel("Текст на български").fill("# Тестово заглавие");
    await expectNoSeriousViolations(page);
  });
});

test("a customer does not see admin pages", async ({
  page,
  context,
  baseURL,
}) => {
  await context.clearCookies();
  await signIn(context, baseURL, fixtures().customer);
  for (const path of ["/admin/products", "/admin/returns", "/admin/legal"]) {
    await page.goto(path);
    await expect(
      page.getByRole("link", { name: "Влез с администраторски профил." }),
    ).toBeVisible();
  }
});
