import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyMovement, availableStock } from "./inventory";

describe("inventory movements", () => {
  it("keeps a delivery, reservation and sale consistent", () => {
    const delivered = applyMovement({ onHand: 0, reserved: 0 }, "receipt", 5);
    const reserved = applyMovement(delivered, "reserve", 2);
    assert.equal(availableStock(reserved), 3);
    assert.deepEqual(applyMovement(reserved, "sale", 2), { onHand: 3, reserved: 0 });
    assert.deepEqual(delivered, { onHand: 5, reserved: 0 });
  });
  it("prevents reserving the same last unit twice", () => {
    const stock = applyMovement({ onHand: 1, reserved: 0 }, "reserve", 1);
    assert.throws(() => applyMovement(stock, "reserve", 1));
  });
  it("releases a cancelled reservation without changing physical stock", () => {
    assert.deepEqual(applyMovement({ onHand: 5, reserved: 2 }, "release", 2), { onHand: 5, reserved: 0 });
  });
  it("adds returned units without removing reservations", () => {
    assert.deepEqual(applyMovement({ onHand: 5, reserved: 2 }, "return", 1), { onHand: 6, reserved: 2 });
  });
  for (const type of ["sale", "release"] as const) {
    it(`rejects ${type} beyond reservations`, () => {
      assert.throws(() => applyMovement({ onHand: 5, reserved: 1 }, type, 2));
    });
  }
  for (const quantity of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    it(`rejects invalid quantity ${quantity}`, () => {
      assert.throws(() => applyMovement({ onHand: 5, reserved: 0 }, "receipt", quantity));
    });
  }
  it("rejects inconsistent starting stock", () => {
    assert.throws(() => availableStock({ onHand: 1, reserved: 2 }));
  });
  it("rejects integer overflow", () => {
    assert.throws(() => applyMovement({ onHand: Number.MAX_SAFE_INTEGER, reserved: 0 }, "receipt", 1));
  });
});
