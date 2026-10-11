import test from "node:test";
import assert from "node:assert/strict";
import { parseOffices } from "./courier-offices";
import { previewCheckout } from "./checkout";
test("Econt offices use shipment codes and exclude lockers and foreign locations", () => {
  const office = {
    id: 1,
    code: "1001",
    name: "Център",
    address: {
      city: { name: "София", country: { code3: "BGR" } },
      fullAddress: "ул. Тест 1",
    },
    shipmentTypes: ["courier"],
  };
  const offices = parseOffices("econt", {
    offices: [
      office,
      { ...office, isAPS: true },
      { ...office, isMPS: true },
      {
        ...office,
        address: {
          ...office.address,
          city: { name: "Друг", country: { code3: "GRC" } },
        },
      },
    ],
  });
  assert.equal(offices.length, 1);
  assert.equal(offices[0].id, "1001");
  assert.equal(offices[0].city, "София");
});
test("Speedy normalizes identifiers and rejects malformed upstream responses", () => {
  const offices = parseOffices("speedy", {
    offices: [
      {
        id: 123,
        name: "Център",
        address: {
          siteName: "София",
          countryId: 100,
          fullAddressString: "ул. Тест",
        },
      },
    ],
  });
  assert.equal(offices[0].id, "123");
  assert.equal(offices[0].courier, "speedy");
  assert.throws(() =>
    parseOffices("speedy", { error: { message: "bad credentials" } }),
  );
  assert.throws(() => parseOffices("econt", { offices: [{ id: 1 }] }));
});
test("checkout validates the office against the server courier list", () => {
  const offices = [
    {
      id: "1001",
      courier: "econt" as const,
      city: "София",
      name: "Офис Център",
    },
  ];
  const input = {
    items: [{ sku: "DEMO-001", quantity: 1 }],
    contact: { name: "Тест", email: "test@example.com", phone: "0888123456" },
    delivery: {
      type: "office",
      courier: "econt",
      city: "София",
      officeId: "1001",
    },
    payment: "cod",
  };
  assert.equal(previewCheckout(input, offices).destination, "Офис Център");
  assert.throws(() =>
    previewCheckout(
      { ...input, delivery: { ...input.delivery, officeId: "tampered" } },
      offices,
    ),
  );
  assert.throws(() =>
    previewCheckout(
      { ...input, delivery: { ...input.delivery, courier: "speedy" } },
      offices,
    ),
  );
});
