import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowed,
  consentCategoriesInUse,
  parseConsent,
  serializeConsent,
} from "./consent";

test("a stored choice round-trips; anything else means no consent", () => {
  const value = serializeConsent(
    { analytics: true, marketing: false },
    new Date("2026-11-23T10:00:00Z"),
  );
  assert.deepEqual(parseConsent(value), {
    version: 1,
    analytics: true,
    marketing: false,
    at: "2026-11-23T10:00:00.000Z",
  });
  for (const junk of [
    undefined,
    "",
    "x",
    encodeURIComponent(
      '{"version":2,"analytics":true,"marketing":true,"at":"2026-01-01"}',
    ),
    encodeURIComponent(
      '{"version":1,"analytics":"yes","marketing":false,"at":"2026-01-01"}',
    ),
  ])
    assert.equal(parseConsent(junk), null, String(junk));
});

test("nothing non-essential loads without an explicit yes", () => {
  assert.equal(allowed(null, "analytics"), false);
  const no = parseConsent(
    serializeConsent({ analytics: false, marketing: false }),
  );
  assert.equal(allowed(no, "analytics"), false);
  const yes = parseConsent(
    serializeConsent({ analytics: true, marketing: false }),
  );
  assert.equal(allowed(yes, "analytics"), true);
  assert.equal(allowed(yes, "marketing"), false);
});

test("the banner is needed only when a non-essential service is configured", () => {
  assert.deepEqual(consentCategoriesInUse({}), []);
  assert.deepEqual(
    consentCategoriesInUse({ ANALYTICS_PROVIDER: "plausible" }),
    ["analytics"],
  );
  assert.deepEqual(
    consentCategoriesInUse({
      ANALYTICS_PROVIDER: " ",
      MARKETING_PROVIDER: "x",
    }),
    ["marketing"],
  );
});
