import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, tokenHash } from "./password";
import { registrationSchema, profileSchema } from "./account-schema";

test("passwords use unique salts and reject incorrect passwords", async () => {
  const password = "test-password-12345";
  const first = await hashPassword(password);
  assert.notEqual(first, await hashPassword(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(await verifyPassword(password, "malformed"), false);
});
test("registration normalizes email and validates required contact fields", () => {
  const input = {
    name: "Тест Клиент",
    email: "TEST@example.com",
    phone: "0888 123 456",
    password: "test-password-12345",
  };
  const parsed = registrationSchema.parse(input);
  assert.equal(parsed.email, "test@example.com");
  assert.equal(parsed.phone, "0888123456");
  for (const change of [
    { name: "" },
    { phone: "123" },
    { password: "short" },
    { email: "invalid" },
  ])
    assert.equal(
      registrationSchema.safeParse({ ...input, ...change }).success,
      false,
    );
});
test("profile accepts no saved delivery, rejects incomplete delivery and unexpected fields", () => {
  const input = { name: "Тест", phone: "0888123456", delivery: null };
  assert.equal(profileSchema.safeParse(input).success, true);
  assert.equal(
    profileSchema.safeParse({
      ...input,
      delivery: { type: "address", city: "София" },
    }).success,
    false,
  );
  assert.equal(
    profileSchema.safeParse({ ...input, email: "changed@example.com" }).success,
    false,
  );
});
test("session token is stored as a deterministic digest", () => {
  assert.equal(tokenHash("secret").length, 64);
  assert.equal(tokenHash("secret"), tokenHash("secret"));
  assert.notEqual(tokenHash("secret"), tokenHash("other"));
});
