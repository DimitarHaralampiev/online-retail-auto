import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { demoProducts } from "./catalog";
import { getPromotion, sellingPrice } from "./pricing";
import { cartSubtotal } from "./cart";
import { previewCheckout } from "./checkout";

describe("promotional pricing", () => {
  it("keeps regular pricing when there is no promotion", () => {
    const product = { ...demoProducts[0], demoSalePriceCents: undefined };
    assert.equal(getPromotion(product), null);
    assert.equal(sellingPrice(product), 2990);
  });
  it("uses a valid reduction and never overstates the percent", () => {
    assert.deepEqual(getPromotion(demoProducts[0]), {
      regularCents: 2990,
      saleCents: 2390,
      savingsCents: 600,
      discountPercent: 20,
    });
    assert.equal(
      getPromotion({
        ...demoProducts[0],
        demoPriceCents: 1000,
        demoSalePriceCents: 1,
      })?.discountPercent,
      99,
    );
  });
  it("ignores invalid or non-reduced sale prices", () => {
    for (const sale of [0, -1, 1.5, NaN, Infinity, 2990, 3000]) {
      const product = { ...demoProducts[0], demoSalePriceCents: sale };
      assert.equal(getPromotion(product), null);
      assert.equal(sellingPrice(product), 2990);
    }
  });
  it("applies the same promotion to cart and server checkout", () => {
    const items = [
      { sku: "DEMO-001", quantity: 2 },
      { sku: "DEMO-003", quantity: 1 },
    ];
    const expected = 2390 * 2 + 1890;
    assert.equal(cartSubtotal(items), expected);
    assert.equal(
      previewCheckout({
        items,
        contact: {
          name: "Тест",
          email: "test@example.com",
          phone: "0888123456",
        },
        delivery: {
          type: "office",
          courier: "speedy",
          city: "София",
          officeId: "DEMO-speedy-0-1",
        },
        payment: "cod",
      }).subtotalCents,
      expected,
    );
  });
  it("rejects an invalid base price", () => {
    assert.throws(() =>
      sellingPrice({ ...demoProducts[0], demoPriceCents: 0 }),
    );
  });
});
