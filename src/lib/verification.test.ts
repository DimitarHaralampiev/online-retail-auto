import test from "node:test";
import assert from "node:assert/strict";
import {
  verificationTokenValid,
  verificationLink,
  confirmEmail,
  mailPreviewUrl,
} from "./verification";
test("verification only accepts 256-bit hex tokens", async () => {
  for (const token of [null, 123, "", "a".repeat(63), "z".repeat(64)]) {
    assert.equal(verificationTokenValid(token), false);
    assert.equal(await confirmEmail(token), false);
  }
  assert.equal(verificationTokenValid("a".repeat(64)), true);
});
test("verification links use configured origin and keep token out of request path", () => {
  const previous = process.env.APP_URL;
  try {
    process.env.APP_URL = "https://shop.example";
    const url = new URL(verificationLink("a".repeat(64)));
    assert.equal(url.origin, "https://shop.example");
    assert.equal(url.pathname, "/account/verify");
    assert.equal(url.search, "");
    assert.equal(url.hash, "#token=" + "a".repeat(64));
    process.env.APP_URL = "https://user:password@shop.example";
    assert.throws(() => verificationLink("a".repeat(64)));
    assert.throws(() => verificationLink("invalid"));
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});

test("local mail preview is hidden in production and for external SMTP", () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
  };
  try {
    Object.assign(process.env, {
      NODE_ENV: "development",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
    });
    assert.equal(mailPreviewUrl(), "http://localhost:8025");
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.equal(mailPreviewUrl(), null);
    Object.assign(process.env, {
      NODE_ENV: "development",
      SMTP_HOST: "smtp.example.com",
    });
    assert.equal(mailPreviewUrl(), null);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
