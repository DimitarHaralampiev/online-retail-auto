import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const header = (page: import("@playwright/test").Page) =>
  page.getByRole("combobox", { name: "Търсене в магазина" });

test("header suggestions open a product with the keyboard", async ({
  page,
}) => {
  await page.goto("/");
  const input = header(page);
  await input.fill("филт");
  const listbox = page.getByRole("listbox", { name: "Предложения" });
  await expect(listbox).toBeVisible();
  await expect(
    listbox.getByRole("option", { name: /Въздушен филтър/ }),
  ).toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  // Categories come first, then products, then "all results".
  await input.press("ArrowDown");
  const first = listbox.getByRole("option").first();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    (await first.getAttribute("id"))!,
  );
  await listbox.getByRole("option", { name: /Въздушен филтър/ }).hover();
  await input.press("Enter");
  await expect(page).toHaveURL(/\/catalog\/DEMO-003$/);
});

test("Escape closes the suggestions and Enter searches the catalog", async ({
  page,
}) => {
  await page.goto("/");
  const input = header(page);
  await input.fill("кърпа");
  const listbox = page.getByRole("listbox", { name: "Предложения" });
  await expect(listbox).toBeVisible();
  await input.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/catalog\?q=%D0%BA%D1%8A%D1%80%D0%BF%D0%B0$/);
});

test("a suggestion is chosen with the mouse", async ({ page }) => {
  await page.goto("/");
  await header(page).fill("чистачки");
  await page
    .getByRole("listbox", { name: "Предложения" })
    .getByRole("option", { name: /Комплект чистачки/ })
    .click();
  await expect(page).toHaveURL(/\/catalog\/DEMO-004$/);
});

test("open suggestions have no serious accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  await header(page).fill("филт");
  await expect(
    page.getByRole("listbox", { name: "Предложения" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(
    serious.map((v) => ({
      rule: v.id,
      targets: v.nodes.map((n) => n.target.join(" ")).slice(0, 5),
    })),
  ).toEqual([]);
});
