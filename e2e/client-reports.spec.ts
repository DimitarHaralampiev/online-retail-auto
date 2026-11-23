// Browser errors reach the shop's own collector (#117), once, without cookies
// or what is after ? and # in the address.
import { expect, test, type Request } from "@playwright/test";

const isReport = (request: Request) =>
  new URL(request.url()).pathname === "/api/client-reports";

test("uncaught errors and rejections are reported once each", async ({
  page,
}) => {
  const reports: Request[] = [];
  page.on("request", (request) => {
    if (isReport(request)) reports.push(request);
  });
  await page.goto("/catalog?q=filter#token=secret");
  const answered = page.waitForResponse((r) => isReport(r.request()));
  await page.evaluate(() => {
    const fail = () => {
      throw new Error("e2e boom");
    };
    for (let i = 0; i < 5; i++) setTimeout(fail, 0);
    void Promise.reject(new Error("e2e rejection"));
  });
  expect((await answered).status()).toBe(204);
  await expect.poll(() => reports.length).toBe(2);
  await page.waitForTimeout(300);
  expect(reports.length).toBe(2);
  const bodies = reports.map((r) => r.postDataJSON());
  expect(bodies.map((b) => b.message).sort()).toEqual([
    "e2e boom",
    "e2e rejection",
  ]);
  for (const body of bodies) expect(body.path).toBe("/catalog");
  for (const request of reports) {
    expect(request.postData()).not.toMatch(/secret|q=filter/);
    expect((await request.allHeaders()).cookie).toBeUndefined();
  }
});

test("a normal visit reports nothing and no vitals are measured", async ({
  page,
}) => {
  const reports: string[] = [];
  page.on("request", (request) => {
    if (isReport(request)) reports.push(request.postData() ?? "");
  });
  for (const path of ["/", "/catalog", "/catalog/DEMO-003", "/cart"])
    await page.goto(path, { waitUntil: "networkidle" });
  expect(reports).toEqual([]);
});
