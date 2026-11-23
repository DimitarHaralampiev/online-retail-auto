import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Fails on serious or critical WCAG 2.1 AA violations in the current state. */
export async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => ({
        rule: v.id,
        impact: v.impact,
        targets: v.nodes.map((node) => node.target.join(" ")).slice(0, 5),
      })),
  ).toEqual([]);
}

/**
 * The page fits the screen's width (WCAG 1.4.10): wide content scrolls or
 * wraps inside its own box. Names what sticks out.
 */
export async function expectNoSidewaysScroll(page: Page) {
  const wide = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= width + 1) return [];
    return [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${el.className} ${Math.round(el.getBoundingClientRect().right)}/${width}`,
      )
      .slice(0, 8);
  });
  expect(wide).toEqual([]);
}
