import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCart,
  readStoredCart,
  cartSubtotal,
  storedCartItems,
} from "./cart";
import { previewCheckout, type CheckoutInput } from "./checkout";
import { productLookup } from "./catalog";
import { demoProducts } from "./catalog-demo-data";

const lookup = productLookup(demoProducts);

const valid: CheckoutInput = {
  items: [{ sku: "DEMO-001", quantity: 2 }],
  contact: {
    name: "Тестов Получател",
    email: "demo@example.com",
    phone: "0888 123 456",
  },
  delivery: {
    type: "office",
    courier: "speedy",
    city: "София",
    officeId: "DEMO-speedy-0-1",
  },
  payment: "cod",
};

describe("cart and checkout", () => {
  it("recovers safely from broken storage and other versions", () => {
    assert.deepEqual(readStoredCart("{", lookup), []);
    assert.deepEqual(readStoredCart('{"version":2,"items":[]}', lookup), []);
    assert.deepEqual(readStoredCart(null, lookup), []);
  });
  it("drops invalid lines and caps duplicates by free stock", () => {
    assert.deepEqual(
      normalizeCart(
        [
          { sku: "DEMO-002", quantity: 2 },
          { sku: "DEMO-002", quantity: 3 },
          { sku: "DEMO-004", quantity: 1 },
          { sku: "missing", quantity: 1 },
          { sku: "DEMO-001", quantity: -1 },
        ],
        lookup,
      ),
      [{ sku: "DEMO-002", quantity: 1 }],
    );
  });
  it("uses integer cents from the catalog", () => {
    assert.equal(cartSubtotal(valid.items, lookup), 2390 * 2);
    const quote = previewCheckout(valid, lookup);
    assert.equal(quote.subtotalCents, 2390 * 2);
    assert.equal(quote.orderCreated, false);
    assert.equal(quote.paymentStatus, "not_started");
    assert.equal(quote.shippingCents, null);
    assert.equal(quote.totalCents, null);
  });
  it("accepts card selection and address delivery without charging", () => {
    const quote = previewCheckout(
      {
        ...valid,
        payment: "card",
        delivery: {
          type: "address",
          courier: "econt",
          city: "София",
          postalCode: "1000",
          street: "Тестова улица",
          number: "1",
          details: "",
        },
      },
      lookup,
    );
    assert.equal(quote.payment, "Банкова карта");
    assert.equal(quote.courier, "Еконт");
    assert.match(quote.destination, /1000 София/);
    assert.equal(quote.paymentStatus, "not_started");
  });
  it("rejects an office from the wrong courier or city", () => {
    for (const delivery of [
      { ...valid.delivery, courier: "econt" },
      { ...valid.delivery, city: "Варна" },
      { ...valid.delivery, officeId: "unknown" },
    ])
      assert.throws(() => previewCheckout({ ...valid, delivery }, lookup));
  });
  it("rejects overselling across duplicate lines", () => {
    assert.throws(() =>
      previewCheckout(
        {
          ...valid,
          items: [
            { sku: "DEMO-002", quantity: 1 },
            { sku: "DEMO-002", quantity: 1 },
          ],
        },
        lookup,
      ),
    );
  });
  it("rejects unknown or unavailable products", () => {
    for (const sku of ["unknown", "DEMO-004", "DEMO-006"])
      assert.throws(() =>
        previewCheckout({ ...valid, items: [{ sku, quantity: 1 }] }, lookup),
      );
  });
  it("rejects client-supplied prices and totals", () => {
    assert.throws(() => previewCheckout({ ...valid, total: 1 }, lookup));
    assert.throws(() =>
      previewCheckout(
        { ...valid, items: [{ ...valid.items[0], price: 1 }] },
        lookup,
      ),
    );
  });
  it("rejects empty carts and invalid quantities", () => {
    assert.throws(() => previewCheckout({ ...valid, items: [] }, lookup));
    for (const quantity of [0, -1, 1.5, 51])
      assert.throws(() =>
        previewCheckout(
          { ...valid, items: [{ sku: "DEMO-001", quantity }] },
          lookup,
        ),
      );
  });
  it("requires recipient details", () => {
    for (const contact of [
      { ...valid.contact, name: " " },
      { ...valid.contact, email: "wrong" },
      { ...valid.contact, phone: "123" },
    ])
      assert.throws(() => previewCheckout({ ...valid, contact }, lookup));
  });
  it("requires a complete address and Bulgarian postcode", () => {
    const address = {
      type: "address",
      courier: "speedy",
      city: "София",
      postalCode: "1000",
      street: "Тестова",
      number: "1",
      details: "",
    };
    for (const delivery of [
      { ...address, city: "" },
      { ...address, postalCode: "123" },
      { ...address, street: "" },
      { ...address, number: "" },
    ])
      assert.throws(() => previewCheckout({ ...valid, delivery }, lookup));
  });
});

describe("stored cart items", () => {
  it("keeps well-formed items without consulting the catalog", () => {
    const raw = JSON.stringify({
      version: 1,
      items: [
        { sku: "ANY-SKU", quantity: 2 },
        { sku: "", quantity: 1 },
        { sku: "X", quantity: 0 },
        { sku: "Y", quantity: 1.5 },
        { sku: "Z".repeat(51), quantity: 1 },
        null,
      ],
    });
    assert.deepEqual(storedCartItems(raw), [{ sku: "ANY-SKU", quantity: 2 }]);
  });
  it("ignores malformed, unversioned or oversized storage", () => {
    assert.deepEqual(storedCartItems("{"), []);
    assert.deepEqual(storedCartItems('{"version":2,"items":[]}'), []);
    assert.deepEqual(
      storedCartItems(
        JSON.stringify({
          version: 1,
          items: Array.from({ length: 51 }, () => ({ sku: "A", quantity: 1 })),
        }),
      ),
      [],
    );
  });
});
