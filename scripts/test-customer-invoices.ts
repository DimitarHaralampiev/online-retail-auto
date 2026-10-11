import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { database } from "../src/lib/accounts";
import {
  scanCustomerNotifications,
  sendCustomerEmails,
} from "../src/lib/customer-notifications";
import { todayInSofia } from "../src/lib/customer-rules";
import { demoProducts } from "../src/lib/catalog";
import {
  parseInvoice,
  compareInvoiceProduct,
  postInvoice,
} from "../src/lib/supplier-invoices";
import type {
  ReviewedInvoice,
  ExtractedInvoice,
} from "../src/lib/invoice-rules";
const root =
  process.env.TEST_APP_URL ?? process.env.APP_URL ?? "http://127.0.0.1:3008";
if (
  !["127.0.0.1", "localhost"].includes(new URL(root).hostname) ||
  (process.env.SMTP_HOST !== "127.0.0.1" &&
    process.env.SMTP_HOST !== "localhost")
)
  throw new Error("Run only against local development and local test SMTP.");
const db = database();
const tag = randomUUID();
const emails = [`features-${tag}@example.test`, `other-${tag}@example.test`];
const password = `Test-${randomBytes(16).toString("hex")}`;
const ids: string[] = [];
const invoices: string[] = [];
const orders: string[] = [];
let originalDelivery: any;
const skus = [`TEST-${tag}-2`, `TEST-${tag}-1`];
const fitmentMake = `TEST-${tag}`;
let browser: any;
const originalFetch = globalThis.fetch;
const previousKey = process.env.OPENAI_API_KEY;
async function post(path: string, body: unknown, cookie = "") {
  const r = await fetch(root + path, {
    method: "POST",
    headers: {
      Origin: root,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
async function get(path: string, cookie = "") {
  const r = await fetch(root + path, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return { status: r.status, data: await r.json() };
}
async function customer(value: unknown, cookie: string) {
  const r = await post("/api/customer", value, cookie);
  assert.equal(r.status, 200, r.data.error);
  return r.data;
}
async function register(index: number) {
  const credentials = {
    email: emails[index],
    password,
    name: "Тест Клиент",
    phone: "0888123456",
  };
  const registered = await post("/api/account", {
    action: "register",
    credentials,
  });
  assert.equal(registered.status, 200);
  assert.equal(registered.data.customer, null);
  assert.equal(
    (
      await post("/api/account", {
        action: "login",
        credentials: { email: emails[index], password },
      })
    ).status,
    403,
  );
  const row = await db.query(
    "SELECT id,notification_preferences FROM customers WHERE email=$1",
    [emails[index]],
  );
  ids.push(row.rows[0].id);
  assert.deepEqual(row.rows[0].notification_preferences, {
    price: false,
    stock: false,
    reminders: false,
  });
  const list = await (
    await fetch(
      `http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${emails[index]}`)}`,
    )
  ).json();
  assert.ok(list.messages.length);
  const mail = await (
    await fetch(`http://127.0.0.1:8025/api/v1/message/${list.messages[0].ID}`)
  ).json();
  const token = mail.Text.match(/\/account\/verify#token=([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  assert.equal(
    (await post("/api/account", { action: "verify", token })).status,
    200,
  );
  assert.equal(
    (await post("/api/account", { action: "verify", token })).status,
    400,
  );
  const login = await post("/api/account", {
    action: "login",
    credentials: { email: emails[index], password },
  });
  assert.equal(login.status, 200);
  assert.ok(login.cookie);
  return login.cookie;
}
function mockedResponse(value: unknown, extra: unknown[] = []) {
  return new Response(
    JSON.stringify({
      status: "completed",
      output: [
        ...extra,
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: typeof value === "string" ? value : JSON.stringify(value),
            },
          ],
        },
      ],
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
async function main() {
  try {
    const cookie = await register(0);
    const other = await register(1);
    assert.equal((await get("/api/customer")).status, 401);
    assert.equal((await get("/api/admin/invoices", cookie)).status, 403);
    await db.query("UPDATE customers SET is_admin=true WHERE id=$1", [ids[0]]);
    originalDelivery =
      (await db.query("SELECT * FROM store_delivery_settings WHERE id=1"))
        .rows[0] ?? null;
    assert.equal((await get("/api/admin/settings", other)).status, 403);
    assert.equal(
      (
        await post(
          "/api/admin/settings",
          { freeShippingEnabled: true, freeShippingAboveCents: 1000 },
          other,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await post(
          "/api/admin/settings",
          { freeShippingEnabled: true, freeShippingAboveCents: -1 },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/api/admin/settings",
          { freeShippingEnabled: true, freeShippingAboveCents: 1000 },
          cookie,
        )
      ).status,
      200,
    );
    let checkoutConfig = (await get("/api/checkout/config")).data;
    assert.equal(checkoutConfig.freeShippingAboveCents, 1000);
    const checkout = {
      items: [{ sku: "DEMO-001", quantity: 1 }],
      contact: { name: "Тест Клиент", email: emails[0], phone: "0888123456" },
      delivery: {
        type: "address",
        courier: "speedy",
        city: "София",
        postalCode: "1000",
        street: "Тестова",
        number: "1",
        details: "",
      },
      payment: "cod",
    };
    const freeOrder = await post(
      "/api/orders",
      {
        requestKey: randomUUID(),
        acknowledgeTest: true,
        expectedTotalCents: 2390,
        checkout,
      },
      cookie,
    );
    assert.equal(freeOrder.status, 200, freeOrder.data.error);
    orders.push(freeOrder.data.id);
    assert.equal(
      (await get(`/api/orders/${freeOrder.data.id}`, cookie)).data.order
        .shippingCents,
      0,
    );
    assert.equal(
      (
        await post(
          "/api/admin/settings",
          { freeShippingEnabled: true, freeShippingAboveCents: 5000 },
          cookie,
        )
      ).status,
      200,
    );
    checkoutConfig = (await get("/api/checkout/config")).data;
    assert.equal(checkoutConfig.freeShippingAboveCents, 5000);
    assert.equal(
      (
        await post(
          "/api/orders",
          {
            requestKey: randomUUID(),
            acknowledgeTest: true,
            expectedTotalCents: 2390,
            checkout,
          },
          cookie,
        )
      ).status,
      400,
    );
    const paidOrder = await post(
      "/api/orders",
      {
        requestKey: randomUUID(),
        acknowledgeTest: true,
        expectedTotalCents: 2390 + checkoutConfig.shippingCents,
        checkout,
      },
      cookie,
    );
    assert.equal(paidOrder.status, 200, paidOrder.data.error);
    orders.push(paidOrder.data.id);
    assert.equal(
      (await get(`/api/orders/${paidOrder.data.id}`, cookie)).data.order
        .shippingCents,
      checkoutConfig.shippingCents,
    );
    assert.equal(
      (await get(`/api/orders/${freeOrder.data.id}`, cookie)).data.order
        .shippingCents,
      0,
    );
    assert.equal(
      (
        await post(
          "/api/admin/settings",
          { freeShippingEnabled: false, freeShippingAboveCents: 1000 },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await get("/api/checkout/config")).data.freeShippingAboveCents,
      null,
    );
    console.log(
      "PASS admin shipping threshold persistence, disabled free shipping, stale total rejection and immutable existing order totals",
    );
    let data = await customer(
      { action: "import-favorites", skus: ["DEMO-001", "DEMO-001"] },
      cookie,
    );
    assert.deepEqual(data.favorites, ["DEMO-001"]);
    assert.equal(
      (
        await post(
          "/api/customer",
          { action: "alert", sku: "DEMO-001", kind: "price", enabled: true },
          cookie,
        )
      ).status,
      400,
    );
    data = await customer(
      {
        action: "preferences",
        preferences: { price: true, stock: true, reminders: true },
      },
      cookie,
    );
    assert.equal(data.preferences.price, true);
    await customer(
      { action: "alert", sku: "DEMO-001", kind: "price", enabled: true },
      cookie,
    );
    await customer(
      { action: "alert", sku: "DEMO-004", kind: "stock", enabled: true },
      cookie,
    );
    const vehicle = {
      nickname: "Тестов автомобил",
      make: fitmentMake,
      model: "Model",
      engine: "1.6 TEST",
      year: 2018,
    };
    data = await customer({ action: "add-vehicle", vehicle }, cookie);
    const first = data.vehicles[0].id;
    assert.equal(data.vehicles[0].selected, true);
    data = await customer(
      {
        action: "add-vehicle",
        vehicle: { ...vehicle, nickname: "Втори автомобил" },
      },
      cookie,
    );
    const second = data.vehicles[1].id;
    assert.equal(data.vehicles.filter((v: any) => v.selected).length, 1);
    assert.equal(
      (
        await post(
          "/api/customer",
          { action: "select-vehicle", id: first },
          other,
        )
      ).status,
      400,
    );
    assert.equal((await get("/api/customer", other)).data.vehicles.length, 0);
    await db.query(
      "INSERT INTO product_fitments(sku,make,model,engine,year_from,year_to) VALUES('DEMO-003',$1,'Model','1.6 TEST',2015,2020)",
      [fitmentMake],
    );
    assert.deepEqual((await get("/api/customer", cookie)).data.compatibleSkus, [
      "DEMO-003",
    ]);
    await customer({ action: "select-vehicle", id: second }, cookie);
    data = await customer(
      {
        action: "add-reminder",
        reminder: {
          vehicleId: first,
          title: "Тестова смяна",
          lastServiceDate: null,
          dueDate: todayInSofia(),
        },
      },
      cookie,
    );
    const reminder = data.reminders[0].id;
    assert.equal(
      (
        await post(
          "/api/customer",
          { action: "delete-reminder", id: reminder },
          other,
        )
      ).status,
      400,
    );
    const changed = demoProducts.map((p) =>
      p.sku === "DEMO-001"
        ? { ...p, demoSalePriceCents: 2290 }
        : p.sku === "DEMO-004"
          ? { ...p, stock: { onHand: 3, reserved: 0 } }
          : p,
    );
    assert.equal(
      await scanCustomerNotifications(changed, todayInSofia(), ids[0]),
      3,
    );
    assert.equal(
      await scanCustomerNotifications(changed, todayInSofia(), ids[0]),
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM customer_email_outbox WHERE customer_id=$1",
          [ids[0]],
        )
      ).rows[0].count,
      3,
    );
    const port = process.env.SMTP_PORT;
    process.env.SMTP_PORT = "1";
    try {
      assert.equal(await sendCustomerEmails(3, ids[0]), 0);
    } finally {
      process.env.SMTP_PORT = port;
    }
    assert.equal(
      (
        await db.query(
          "SELECT sum(attempts)::int AS attempts FROM customer_email_outbox WHERE customer_id=$1",
          [ids[0]],
        )
      ).rows[0].attempts,
      3,
    );
    await db.query(
      "UPDATE customer_email_outbox SET last_attempt_at=now()-interval '2 minutes' WHERE customer_id=$1",
      [ids[0]],
    );
    assert.equal(await sendCustomerEmails(3, ids[0]), 3);
    const cheaper = changed.map((p) =>
      p.sku === "DEMO-001" ? { ...p, demoSalePriceCents: 2190 } : p,
    );
    assert.equal(
      await scanCustomerNotifications(cheaper, todayInSofia(), ids[0]),
      1,
    );
    await customer(
      {
        action: "preferences",
        preferences: { price: false, stock: false, reminders: false },
      },
      cookie,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM customer_email_outbox WHERE customer_id=$1 AND sent_at IS NULL",
          [ids[0]],
        )
      ).rows[0].count,
      0,
    );
    assert.equal(
      await scanCustomerNotifications(
        demoProducts.map((p) =>
          p.sku === "DEMO-001" ? { ...p, demoSalePriceCents: 2090 } : p,
        ),
        todayInSofia(),
        ids[0],
      ),
      0,
    );
    await customer({ action: "delete-vehicle", id: first }, cookie);
    assert.equal((await get("/api/customer", cookie)).data.reminders.length, 0);
    assert.equal(
      (
        await post(
          "/api/customer",
          { action: "delete-vehicle", id: second },
          other,
        )
      ).status,
      400,
    );
    console.log(
      "PASS registration mail, one-time verification, login, preferences, ownership, fitment, stock/price reminders, SMTP retry and opt-out",
    );
    const pdf = Buffer.from(
      "%PDF-1.4\n% synthetic integration invoice " + tag + "\n%%EOF",
    );
    async function upload(bytes: Buffer, auth = cookie) {
      const form = new FormData();
      form.set(
        "invoice",
        new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
        "synthetic-invoice.pdf",
      );
      const r = await fetch(root + "/api/admin/invoices", {
        method: "POST",
        headers: { Origin: root, Cookie: auth },
        body: form,
      });
      return { status: r.status, data: await r.json() };
    }
    assert.equal((await upload(pdf, other)).status, 403);
    const badPdf = await upload(Buffer.from("not a pdf"));
    assert.equal(
      badPdf.status,
      400,
      `Invalid PDF rejection: ${badPdf.data.error}`,
    );
    const uploaded = await upload(pdf);
    assert.equal(uploaded.status, 200, uploaded.data.error);
    const invoiceId = uploaded.data.id;
    invoices.push(invoiceId);
    assert.equal((await upload(pdf)).data.duplicate, true);
    assert.equal(
      (await get(`/api/admin/invoices/${invoiceId}`, other)).status,
      403,
    );
    const extracted: ExtractedInvoice = {
      documentType: "invoice",
      supplierName: "Тест Доставчик",
      supplierTaxId: "TEST-SUPPLIER-" + tag,
      invoiceNumber: "TEST-1",
      invoiceDate: "2026-10-10",
      currency: "EUR",
      netTotal: 20,
      vatTotal: 4,
      grossTotal: 24,
      lines: [
        {
          description: "Тестов филтър",
          supplierCode: "SUP-1",
          brand: "TEST BRAND",
          manufacturerCode: "TEST-PART",
          ean: null,
          unit: "бр.",
          quantity: 2,
          unitNetPrice: 10,
          lineNetTotal: 20,
          vatRate: 20,
        },
      ],
      warnings: ["Синтетичен отговор само за интеграционен тест."],
    };
    process.env.OPENAI_API_KEY = "integration-mock-only";
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      if (String(input) === "https://api.openai.com/v1/responses") {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.store, false);
        assert.equal(body.input[0].content[0].type, "input_file");
        assert.equal(body.text.format.strict, true);
        return mockedResponse(extracted);
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    assert.equal(
      (await parseInvoice(invoiceId, ids[0])).extracted.lines[0].quantity,
      2,
    );
    globalThis.fetch = originalFetch;
    const review: ReviewedInvoice = {
      supplierName: extracted.supplierName!,
      supplierTaxId: extracted.supplierTaxId!,
      invoiceNumber: "TEST-1",
      invoiceDate: "2026-10-10",
      currency: "EUR",
      exchangeRate: 1,
      netTotalCents: 2000,
      purchaseVatTotalCents: 400,
      inboundShippingCents: 301,
      otherAcquisitionCents: 0,
      recoverPurchaseVat: true,
      confirmed: true,
      lines: [
        {
          sku: skus[0],
          name: "Тестов филтър",
          brand: "TEST BRAND",
          manufacturerCode: "TEST-PART",
          ean: "",
          quantity: 2,
          unitNetCents: 1000,
          purchaseVatBps: 2000,
        },
      ],
    };
    assert.equal(
      (
        await post(
          `/api/admin/invoices/${invoiceId}`,
          { action: "post", invoice: { ...review, netTotalCents: 1 } },
          cookie,
        )
      ).status,
      400,
    );
    const results = await Promise.all([
      post(
        `/api/admin/invoices/${invoiceId}`,
        { action: "post", invoice: review },
        cookie,
      ),
      post(
        `/api/admin/invoices/${invoiceId}`,
        { action: "post", invoice: review },
        cookie,
      ),
    ]);
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(results.filter((r) => r.data.alreadyPosted).length, 1);
    let product = (
      await db.query("SELECT * FROM warehouse_products WHERE sku=$1", [skus[0]])
    ).rows[0];
    assert.equal(product.on_hand, 2);
    assert.equal(Number(product.inventory_value_cents), 2301);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM warehouse_receipts WHERE invoice_id=$1",
          [invoiceId],
        )
      ).rows[0].count,
      1,
    );
    const duplicated = await upload(
      Buffer.concat([pdf, Buffer.from("\nsecond scan")]),
    );
    invoices.push(duplicated.data.id);
    assert.equal(
      (
        await post(
          `/api/admin/invoices/${duplicated.data.id}`,
          { action: "post", invoice: review },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await db.query("SELECT on_hand FROM warehouse_products WHERE sku=$1", [
          skus[0],
        ])
      ).rows[0].on_hand,
      2,
    );
    const mixed = await upload(
      Buffer.concat([pdf, Buffer.from("\nrollback invoice")]),
    );
    invoices.push(mixed.data.id);
    const conflict = {
      ...review,
      invoiceNumber: "TEST-2",
      netTotalCents: 3000,
      purchaseVatTotalCents: 600,
      lines: [
        { ...review.lines[0], sku: skus[1], quantity: 1 },
        { ...review.lines[0], quantity: 2, brand: "DIFFERENT" },
      ],
    };
    assert.equal(
      (
        await post(
          `/api/admin/invoices/${mixed.data.id}`,
          { action: "post", invoice: conflict },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM warehouse_products WHERE sku=$1",
          [skus[1]],
        )
      ).rows[0].count,
      0,
    );
    await db.query(
      "UPDATE invoice_ai_requests SET created_at=now()-interval '15 seconds' WHERE actor_id=$1",
      [ids[0]],
    );
    let calls = 0;
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      if (String(input) === "https://api.openai.com/v1/responses") {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.store, false);
        assert.ok(!JSON.stringify(body.input).includes("TEST-SUPPLIER"));
        assert.ok(!JSON.stringify(body.input).includes("unitNetCents"));
        if (calls === 1) {
          assert.equal(body.tools[0].type, "web_search");
          assert.equal(body.tool_choice, "required");
          return mockedResponse(
            "Test public offer, TEST BRAND / TEST-PART, 24 EUR including VAT, one unit, in stock.",
            [
              {
                type: "web_search_call",
                action: {
                  sources: [{ url: "https://shop.example.test/part" }],
                },
              },
            ],
          );
        }
        return mockedResponse({
          summary: "Синтетичен пазарен резултат.",
          offers: [
            {
              shop: "Тестов магазин",
              url: "https://shop.example.test/part",
              title: "Тестов филтър",
              brand: "TEST BRAND",
              manufacturerCode: "TEST-PART",
              ean: null,
              packQuantity: 1,
              price: 24,
              currency: "EUR",
              availability: "in_stock",
              includesVat: true,
              shippingNote: "Неизвестна доставка",
              evidence: "TEST-PART, една бройка",
            },
            {
              shop: "Fabricated",
              url: "https://invented.example.test/part",
              title: "Fake",
              brand: "TEST BRAND",
              manufacturerCode: "TEST-PART",
              ean: null,
              packQuantity: 1,
              price: 1,
              currency: "EUR",
              availability: "in_stock",
              includesVat: true,
              shippingNote: "Unknown",
              evidence: "None",
            },
          ],
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    const market = await compareInvoiceProduct(
      invoiceId,
      review.lines[0],
      ids[0],
    );
    assert.equal(calls, 2);
    assert.equal(market.offers.length, 1);
    assert.equal(market.offers[0].usableForComparison, true);
    assert.equal(market.needsHumanReview, true);
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    console.log(
      "PASS protected PDF upload, mocked AI extraction/search, source filtering, SQL receipts, concurrent deduplication, invoice identity and full rollback",
    );
    if (process.env.TEST_PLAYWRIGHT_MODULE) {
      const { chromium } = await import(process.env.TEST_PLAYWRIGHT_MODULE);
      browser = await chromium.launch({
        executablePath: process.env.TEST_CHROME ?? "/usr/bin/google-chrome",
        args: ["--no-sandbox"],
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => {
        errors.push(e.message);
        console.error("Browser exception:", e.message);
      });
      await page.goto(root + "/for-you");
      await page
        .getByRole("heading", { name: "Три отметки. Пълен контрол." })
        .waitFor();
      await page.screenshot({
        path: "docs/screenshots/customer-services-desktop.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.goto(root + "/account");
      await page
        .getByRole("button", { name: "Регистрация", exact: true })
        .click();
      assert.equal(
        await page.locator(".notification-choice input:checked").count(),
        0,
      );
      await page.screenshot({
        path: "docs/screenshots/registration-services-desktop.png",
        fullPage: true,
      });
      await page.goto(root + "/catalog");
      await page
        .getByRole("button", {
          name: "Добави в любими: Органайзер за багажник",
        })
        .click();
      await page.goto(root + "/favorites");
      await page
        .getByRole("button", {
          name: "Премахни от любими: Органайзер за багажник",
        })
        .waitFor();
      await page.reload();
      await page
        .getByRole("button", {
          name: "Премахни от любими: Органайзер за багажник",
        })
        .waitFor();
      await context.addCookies([
        { name: "auto_session", value: cookie.split("=")[1], url: root },
      ]);
      await page.goto(root + "/account");
      await page
        .getByRole("heading", { name: "Моите услуги", exact: true })
        .waitFor();
      await page.getByLabel("Намаления на избрани продукти").check();
      await page.getByRole("button", { name: "Запази моите услуги" }).click();
      await page.getByText("Изборът ти е запазен.").waitFor();
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLInputElement>(
            "#services .notification-choice input",
          )?.checked === true,
      );
      assert.equal(
        await page.getByLabel("Намаления на избрани продукти").isChecked(),
        true,
      );
      await page
        .getByRole("button", { name: "Добави продуктите отново →" })
        .first()
        .click();
      await page
        .getByText(
          "Наличните продукти са добавени в количката с текущите цени.",
          { exact: false },
        )
        .waitFor();
      const cart = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("auto-shop:cart:v1") ?? "{}"),
      );
      assert.equal(cart.items[0].sku, "DEMO-001");
      assert.equal(cart.items[0].quantity, 1);
      await page.goto(root + "/admin/settings");
      await page
        .getByRole("heading", { name: "Кой плаща доставката?" })
        .waitFor();
      await page
        .getByLabel("Безплатна доставка над определена стойност")
        .check();
      await page
        .getByLabel("Праг на стойността на продуктите (EUR)")
        .fill("30");
      await page
        .getByRole("button", { name: "Запази правилото за доставка" })
        .click();
      await page
        .getByText("Правилото за доставка е запазено и важи за новите поръчки.")
        .waitFor();
      await page.reload();
      assert.equal(
        await page
          .getByLabel("Праг на стойността на продуктите (EUR)")
          .inputValue(),
        "30",
      );
      await page.screenshot({
        path: "docs/screenshots/admin-delivery-settings-desktop.png",
        fullPage: true,
      });
      await page.goto(root + "/garage");
      await page
        .getByRole("heading", { name: "Добави автомобил", exact: true })
        .waitFor();
      await page.screenshot({
        path: "docs/screenshots/garage-desktop.png",
        fullPage: true,
      });
      await page.goto(root + "/admin/invoices");
      await page
        .getByRole("button", {
          name: "synthetic-invoice.pdf Заприходена",
          exact: true,
        })
        .click();
      await page
        .getByText(
          "Фактурата вече е заприходена. Повторно добавяне на наличност е блокирано.",
        )
        .waitFor()
        .catch(async (e: unknown) => {
          await page.screenshot({
            path: "/tmp/invoice-browser-failure.png",
            fullPage: true,
          });
          console.error(
            "Invoice UI alerts:",
            await page.locator("[role=alert]").allTextContents(),
          );
          throw e;
        });
      await page
        .getByRole("heading", { name: "3. Себестойност и цена" })
        .waitFor();
      await page.screenshot({
        path: "docs/screenshots/invoice-ai-desktop.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(root + "/for-you");
      await page.screenshot({
        path: "docs/screenshots/customer-services-mobile.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.goto(root + "/admin/invoices");
      await page
        .getByRole("button", {
          name: "synthetic-invoice.pdf Заприходена",
          exact: true,
        })
        .click();
      await page
        .getByRole("heading", { name: "3. Себестойност и цена" })
        .waitFor();
      await page.screenshot({
        path: "docs/screenshots/invoice-ai-mobile.png",
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      await browser.close();
      browser = null;
      console.log(
        "PASS desktop/mobile browser services, registration choices, guest favorites, persisted preferences and invoice UI without console errors",
      );
    }
    assert.equal(
      (await post("/api/account", { action: "logout" }, cookie)).status,
      200,
    );
    assert.equal((await get("/api/customer", cookie)).status, 401);
    console.log("PASS logout invalidates session");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (browser) await browser.close();
    const currentDelivery = (
      await db.query(
        "SELECT updated_by FROM store_delivery_settings WHERE id=1",
      )
    ).rows[0];
    if (currentDelivery?.updated_by === ids[0]) {
      if (originalDelivery)
        await db.query(
          "UPDATE store_delivery_settings SET free_shipping_enabled=$1,free_shipping_above_cents=$2,updated_by=$3,updated_at=$4 WHERE id=1",
          [
            originalDelivery.free_shipping_enabled,
            originalDelivery.free_shipping_above_cents,
            originalDelivery.updated_by,
            originalDelivery.updated_at,
          ],
        );
      else
        await db.query(
          "DELETE FROM store_delivery_settings WHERE id=1 AND updated_by=$1",
          [ids[0]],
        );
    }
    await db.query(
      "DELETE FROM order_email_outbox WHERE order_id=ANY($1::uuid[])",
      [orders],
    );
    await db.query("DELETE FROM order_history WHERE order_id=ANY($1::uuid[])", [
      orders,
    ]);
    await db.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [orders]);
    await db.query(
      "DELETE FROM invoice_market_research WHERE invoice_id=ANY($1::uuid[])",
      [invoices],
    );
    await db.query(
      "DELETE FROM invoice_ai_requests WHERE invoice_id=ANY($1::uuid[])",
      [invoices],
    );
    await db.query(
      "DELETE FROM warehouse_receipts WHERE invoice_id=ANY($1::uuid[])",
      [invoices],
    );
    await db.query("DELETE FROM supplier_invoices WHERE id=ANY($1::uuid[])", [
      invoices,
    ]);
    await db.query("DELETE FROM warehouse_products WHERE sku=ANY($1::text[])", [
      skus,
    ]);
    await db.query("DELETE FROM product_fitments WHERE make=$1", [fitmentMake]);
    await db.query("DELETE FROM customers WHERE email=ANY($1::text[])", [
      emails,
    ]);
    await db.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Integration test failed",
  );
  if (error instanceof Error)
    console.error(
      error.stack
        ?.split("\n")
        .filter((line) => line.includes("scripts/test-customer-invoices.ts"))
        .join("\n"),
    );
  process.exitCode = 1;
});
