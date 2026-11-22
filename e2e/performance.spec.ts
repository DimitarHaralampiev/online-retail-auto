// Performance budget (#43, ADR 0004): Core Web Vitals measured in the browser
// on key pages, plus the JavaScript each page downloads. Budgets follow
// Google's "good" thresholds (LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms) and a
// JavaScript budget, so a regression fails CI instead of reaching shoppers.
import { expect, test, type Page } from "@playwright/test";

const BUDGET = {
  lcpMs: 2500,
  cls: 0.1,
  interactionMs: 200,
  // Compressed script bytes per page (first visit). Measured 203–209 KB in
  // CI (2026-11-23); about 25 % headroom, so dependency growth is noticed.
  scriptKb: 260,
};

async function vitals(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ lcp: number; cls: number; scriptKb: number }>((resolve) => {
        let lcp = 0;
        let cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) lcp = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          })[])
            if (!entry.hadRecentInput) cls += entry.value;
        }).observe({ type: "layout-shift", buffered: true });
        // Let the observers deliver buffered entries.
        setTimeout(() => {
          const scripts = (
            performance.getEntriesByType(
              "resource",
            ) as PerformanceResourceTiming[]
          ).filter((r) => r.initiatorType === "script");
          const bytes = scripts.reduce((sum, r) => sum + r.encodedBodySize, 0);
          resolve({ lcp, cls, scriptKb: Math.round(bytes / 1024) });
        }, 500);
      }),
  );
}

for (const path of ["/", "/catalog", "/catalog/DEMO-003"])
  test(`${path} stays within the performance budget`, async ({
    page,
  }, info) => {
    await page.goto(path, { waitUntil: "networkidle" });
    const result = await vitals(page);
    info.annotations.push({
      type: "vitals",
      description: `LCP ${Math.round(result.lcp)} ms, CLS ${result.cls.toFixed(3)}, JS ${result.scriptKb} KB`,
    });
    console.log(`${info.project.name} ${path}`, result);
    expect(result.lcp).toBeGreaterThan(0);
    expect(result.lcp).toBeLessThanOrEqual(BUDGET.lcpMs);
    expect(result.cls).toBeLessThanOrEqual(BUDGET.cls);
    expect(result.scriptKb).toBeLessThanOrEqual(BUDGET.scriptKb);
  });

test("a catalog interaction responds within the INP budget", async ({
  page,
}) => {
  await page.goto("/catalog", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    (window as unknown as { __events: number[] }).__events = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        (window as unknown as { __events: number[] }).__events.push(
          entry.duration,
        );
    }).observe({
      type: "event",
      durationThreshold: 16,
      buffered: true,
    } as PerformanceObserverInit);
  });
  await page.getByRole("button", { name: "Списък" }).click();
  await expect(page.getByRole("button", { name: "Списък" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(300);
  const durations = await page.evaluate(
    () => (window as unknown as { __events: number[] }).__events,
  );
  const worst = Math.max(0, ...durations);
  console.log("interaction", { worst, events: durations.length });
  expect(worst).toBeLessThanOrEqual(BUDGET.interactionMs);
});
