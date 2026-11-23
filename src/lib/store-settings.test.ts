import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverySettingsSchema } from "./store-settings";

test("the card payment window must stay within 30 to 180 minutes", () => {
  const base = { freeShippingEnabled: true, freeShippingAboveCents: 3000 };
  assert.equal(
    deliverySettingsSchema.parse({ ...base, cardPaymentWindowMinutes: 45 })
      .cardPaymentWindowMinutes,
    45,
  );
  // Older clients that do not send it keep the stored window.
  assert.equal(
    deliverySettingsSchema.parse(base).cardPaymentWindowMinutes,
    undefined,
  );
  for (const minutes of [29, 181, 45.5])
    assert.throws(() =>
      deliverySettingsSchema.parse({
        ...base,
        cardPaymentWindowMinutes: minutes,
      }),
    );
});
