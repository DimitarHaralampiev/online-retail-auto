import { test } from "node:test";
import assert from "node:assert/strict";
import {
  customerActionSchema,
  fitmentMatches,
  prepareRepeatOrder,
  todayInSofia,
  reminderSchema,
  type Vehicle,
} from "./customer-rules";
import { registrationSchema } from "./account-schema";
import { readGuestFavorites } from "./guest-favorites";
import { demoProducts } from "./catalog";
test("registration leaves optional emails disabled unless explicitly selected", () => {
  const base = {
    name: "Тест Клиент",
    phone: "0888123456",
    email: "test@example.test",
    password: "password12345",
  };
  assert.deepEqual(registrationSchema.parse(base).notificationPreferences, {
    price: false,
    stock: false,
    reminders: false,
  });
  assert.equal(
    registrationSchema.parse({
      ...base,
      notificationPreferences: { price: true, stock: false, reminders: false },
    }).notificationPreferences.price,
    true,
  );
  assert.equal(
    registrationSchema.safeParse({
      ...base,
      notificationPreferences: { price: "yes", stock: false, reminders: false },
    }).success,
    false,
  );
});
test("guest favorites reject corrupt storage, unknown SKUs and deduplicate", () => {
  assert.deepEqual(readGuestFavorites("broken"), []);
  assert.deepEqual(
    readGuestFavorites(
      JSON.stringify([
        demoProducts[0].sku,
        demoProducts[0].sku,
        "UNKNOWN",
        null,
      ]),
    ),
    [demoProducts[0].sku],
  );
  assert.deepEqual(
    readGuestFavorites(JSON.stringify(Array(101).fill(demoProducts[0].sku))),
    [],
  );
});
test("customer actions reject unrecognized SKUs and injected ownership", () => {
  assert.equal(
    customerActionSchema.safeParse({
      action: "favorite",
      sku: "UNKNOWN",
      enabled: true,
    }).success,
    false,
  );
  assert.equal(
    customerActionSchema.safeParse({
      action: "favorite",
      sku: demoProducts[0].sku,
      enabled: true,
      customerId: "other",
    }).success,
    false,
  );
});
test("fitment requires matching engine, model and inclusive year range", () => {
  const v: Vehicle = {
    id: "test",
    nickname: "",
    make: " VW ",
    model: "Golf VII",
    year: 2018,
    engine: "1.6 TDI",
    selected: true,
  };
  const f = {
    make: "vw",
    model: "Golf VII",
    engine: "1.6 TDI",
    year_from: 2013,
    year_to: 2018,
  };
  assert.equal(fitmentMatches(v, f), true);
  assert.equal(fitmentMatches({ ...v, year: 2019 }, f), false);
  assert.equal(fitmentMatches({ ...v, engine: "2.0 TDI" }, f), false);
});
test("repeat order uses current free stock, combines duplicates and skips missing products", () => {
  const result = prepareRepeatOrder([
    { sku: demoProducts[1].sku, quantity: 3 },
    { sku: demoProducts[1].sku, quantity: 2 },
    { sku: demoProducts[3].sku, quantity: 1 },
    { sku: "UNKNOWN", quantity: 1 },
    { sku: demoProducts[0].sku, quantity: -1 },
  ]);
  assert.deepEqual(result.items, [{ sku: demoProducts[1].sku, quantity: 1 }]);
  assert.equal(result.reduced.length, 1);
  assert.equal(result.skipped.length, 2);
});
test("reminders use Sofia date and reject invalid manual dates", () => {
  assert.equal(todayInSofia(new Date("2026-10-10T22:30:00Z")), "2026-10-11");
  assert.equal(
    reminderSchema.safeParse({
      vehicleId: "6ab124fe-184e-4ddc-82f9-b9395a83b147",
      title: "Oil",
      dueDate: "2000-01-01",
      lastServiceDate: null,
    }).success,
    false,
  );
});
