import assert from "node:assert/strict";
import { test } from "node:test";
import { companyDetails, legalText } from "./legal";

test("English falls back to Bulgarian, and says so", () => {
  assert.deepEqual(legalText({ contentBg: "БГ", contentEn: "EN" }, "en"), {
    text: "EN",
    fallback: false,
  });
  assert.deepEqual(legalText({ contentBg: "БГ", contentEn: "  " }, "en"), {
    text: "БГ",
    fallback: true,
  });
  assert.deepEqual(legalText({ contentBg: "БГ", contentEn: "EN" }, "bg"), {
    text: "БГ",
    fallback: false,
  });
  assert.deepEqual(legalText({ contentBg: "", contentEn: "" }, "en"), {
    text: "",
    fallback: false,
  });
});

test("only configured trader details are shown", () => {
  assert.deepEqual(companyDetails({}), []);
  assert.deepEqual(
    companyDetails({
      COMPANY_NAME: " Авто ЕООД ",
      COMPANY_EMAIL: "",
      COMPANY_REGISTRATION: "123456789",
    }).map((f) => [f.label[0], f.value]),
    [
      ["Търговец", "Авто ЕООД"],
      ["ЕИК", "123456789"],
    ],
  );
});
