import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const path of [
  "/",
  "/catalog",
  "/catalog/DEMO-003",
  "/cart",
  "/checkout",
  "/promotions",
  "/account",
]) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const serious = results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(
      serious.map((violation) => ({
        rule: violation.id,
        impact: violation.impact,
        targets: violation.nodes
          .map((node) => node.target.join(" "))
          .slice(0, 5),
      })),
    ).toEqual([]);
  });
}
