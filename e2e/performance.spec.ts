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

// One entry per user interaction, split as in the INP breakdown: input delay,
// event handlers and the time until the next frame is shown.
type InteractionTiming = {
  name: string;
  wait: number;
  handlers: number;
  paint: number;
  duration: number;
};

test("a catalog interaction responds within the INP budget", async ({
  page,
}) => {
  await page.goto("/catalog", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const events: InteractionTiming[] = [];
    (window as unknown as { __events: InteractionTiming[] }).__events = events;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEventTiming & {
        interactionId?: number;
      })[]) {
        // Like INP, only interactions (clicks, taps, key presses) count, not
        // hover events the browser fires while the page lays out.
        if (!entry.interactionId) continue;
        events.push({
          name: entry.name,
          wait: Math.round(entry.processingStart - entry.startTime),
          handlers: Math.round(entry.processingEnd - entry.processingStart),
          paint: Math.round(
            entry.startTime + entry.duration - entry.processingEnd,
          ),
          duration: entry.duration,
        });
      }
    }).observe({
      type: "event",
      durationThreshold: 16,
    } as PerformanceObserverInit);
  });
  await page.getByRole("button", { name: "Списък" }).click();
  await expect(page.getByRole("button", { name: "Списък" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(300);
  const events = await page.evaluate(
    () => (window as unknown as { __events: InteractionTiming[] }).__events,
  );
  const worst = Math.max(0, ...events.map((event) => event.duration));
  console.log("interaction", { worst, events: JSON.stringify(events) });
  expect(worst, `interactions: ${JSON.stringify(events)}`).toBeLessThanOrEqual(
    BUDGET.interactionMs,
  );
});
