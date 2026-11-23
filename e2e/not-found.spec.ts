// Unknown addresses (#134): in the visitor's language, with the shop around.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const path of ["/nyama-takava", "/catalog/NOPE-1", "/legal/nope", "/cars"])
  test(`${path} is a Bulgarian 404 with the shop around it`, async ({
    page,
  }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Няма такава страница." }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/Страницата не е намерена/);
    await expect(page.getByRole("banner")).toBeVisible();
    for (const robots of await page
      .locator('meta[name="robots"]')
      .evaluateAll((all) => all.map((m) => m.getAttribute("content"))))
      expect(robots).toContain("noindex");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    await page
      .getByRole("main")
      .getByRole("link", { name: /Към каталога/ })
      .click();
    await expect(page).toHaveURL(/\/catalog$/);
  });

test("the not-found page speaks English", async ({ page }) => {
  const response = await page.goto("/no-such-page?lang=en");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "There is no such page." }),
  ).toBeVisible();
  await expect(page.getByText("This page could not be found")).toHaveCount(0);
});
