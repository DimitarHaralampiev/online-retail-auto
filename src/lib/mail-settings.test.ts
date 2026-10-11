import test from "node:test";
import assert from "node:assert/strict";
import { smtpSettings } from "./mail-settings";
test("external SMTP requires encryption even during local development", () => {
  const config = smtpSettings({
    SMTP_HOST: "smtp.example.com",
    SMTP_FROM: "Shop <shop@example.com>",
    SMTP_PORT: "587",
    SMTP_USER: "user",
    SMTP_PASSWORD: "secret",
    NODE_ENV: "development",
  });
  assert.equal(config.requireTLS, true);
  assert.equal(config.secure, false);
});
test("Gmail SSL transport supports app password groups", () => {
  const config = smtpSettings({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_FROM: "shop@gmail.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "shop@gmail.com",
    SMTP_PASSWORD: "abcd efgh ijkl mnop",
  });
  assert.equal(config.secure, true);
  assert.equal(config.auth?.pass, "abcdefghijklmnop");
});
test("mail setup rejects missing credentials or invalid ports and keeps Mailpit local", () => {
  assert.throws(() => smtpSettings({}));
  assert.throws(() =>
    smtpSettings({
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "shop@example.com",
      SMTP_USER: "user",
    }),
  );
  assert.throws(() =>
    smtpSettings({
      SMTP_HOST: "localhost",
      SMTP_FROM: "shop@example.test",
      SMTP_PORT: "invalid",
    }),
  );
  assert.equal(
    smtpSettings({
      SMTP_HOST: "127.0.0.1",
      SMTP_FROM: "shop@example.test",
      SMTP_PORT: "1025",
      NODE_ENV: "development",
    }).requireTLS,
    false,
  );
});
