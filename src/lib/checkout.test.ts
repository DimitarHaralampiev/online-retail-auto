import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeCart, readStoredCart, cartSubtotal } from "./cart";
import { previewCheckout, type CheckoutInput } from "./checkout";

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
    assert.deepEqual(readStoredCart("{"), []);
    assert.deepEqual(readStoredCart('{"version":2,"items":[]}'), []);
    assert.deepEqual(readStoredCart(null), []);
  });
  it("drops invalid lines and caps duplicates by free stock", () => {
    assert.deepEqual(
      normalizeCart([
        { sku: "DEMO-002", quantity: 2 },
        { sku: "DEMO-002", quantity: 3 },
        { sku: "DEMO-004", quantity: 1 },
        { sku: "missing", quantity: 1 },
        { sku: "DEMO-001", quantity: -1 },
      ]),
      [{ sku: "DEMO-002", quantity: 1 }],
    );
  });
  it("uses integer cents from the catalog", () => {
    assert.equal(cartSubtotal(valid.items), 2390 * 2);
    const quote = previewCheckout(valid);
    assert.equal(quote.subtotalCents, 2390 * 2);
    assert.equal(quote.orderCreated, false);
    assert.equal(quote.paymentStatus, "not_started");
    assert.equal(quote.shippingCents, null);
    assert.equal(quote.totalCents, null);
  });
  it("accepts card selection and address delivery without charging", () => {
    const quote = previewCheckout({
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
    });
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
      assert.throws(() => previewCheckout({ ...valid, delivery }));
  });
  it("rejects overselling across duplicate lines", () => {
    assert.throws(() =>
      previewCheckout({
        ...valid,
        items: [
          { sku: "DEMO-002", quantity: 1 },
          { sku: "DEMO-002", quantity: 1 },
        ],
      }),
    );
  });
  it("rejects unknown or unavailable products", () => {
    for (const sku of ["unknown", "DEMO-004", "DEMO-006"])
      assert.throws(() =>
        previewCheckout({ ...valid, items: [{ sku, quantity: 1 }] }),
      );
  });
  it("rejects client-supplied prices and totals", () => {
    assert.throws(() => previewCheckout({ ...valid, total: 1 }));
    assert.throws(() =>
      previewCheckout({ ...valid, items: [{ ...valid.items[0], price: 1 }] }),
    );
  });
  it("rejects empty carts and invalid quantities", () => {
    assert.throws(() => previewCheckout({ ...valid, items: [] }));
    for (const quantity of [0, -1, 1.5, 51])
      assert.throws(() =>
        previewCheckout({ ...valid, items: [{ sku: "DEMO-001", quantity }] }),
      );
  });
  it("requires recipient details", () => {
    for (const contact of [
      { ...valid.contact, name: " " },
      { ...valid.contact, email: "wrong" },
      { ...valid.contact, phone: "123" },
    ])
      assert.throws(() => previewCheckout({ ...valid, contact }));
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
      assert.throws(() => previewCheckout({ ...valid, delivery }));
  });
});
