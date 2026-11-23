// Security headers (#51): every page has a nonce-based CSP, and the shop
// works under it — no blocked scripts, styles or images.
import { expect, test } from "@playwright/test";

for (const path of [
  "/",
  "/catalog",
  "/catalog/DEMO-003",
  "/cart",
  "/checkout",
  "/legal/terms",
])
  test(`${path} runs under a strict CSP without violations`, async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (
        /Content Security Policy|Refused to (load|execute|apply)/i.test(
          message.text(),
        )
      )
        violations.push(message.text());
    });
    const response = await page.goto(path, { waitUntil: "networkidle" });
    const csp = response!.headers()["content-security-policy"];
    expect(csp).toMatch(
      /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response!.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response!.headers()["x-frame-options"]).toBe("DENY");
    expect(response!.headers()["x-powered-by"]).toBeUndefined();
    // Hydrated: the header search reacts to input.
    await page.getByRole("combobox", { name: "Търсене в магазина" }).fill("ф");
    expect(violations).toEqual([]);
  });

test("each response gets a new nonce", async ({ request }) => {
  const nonce = async () =>
    (await request.get("/"))
      .headers()
      ["content-security-policy"].match(/nonce-([^']+)/)![1];
  expect(await nonce()).not.toBe(await nonce());
});
