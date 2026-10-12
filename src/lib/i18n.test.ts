import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { localizeTree } from "../components/localize";
import { translate } from "./i18n/translate";
import { localeFromCookie } from "./i18n/locale";

test("language cookie falls back to Bulgarian and accepts English", () => {
  assert.equal(localeFromCookie("auto_locale=en"), "en");
  assert.equal(localeFromCookie("auto_locale=de"), "bg");
});
test("translation covers paragraphs and dynamic accessible labels", () => {
  assert.equal(translate("Количка: 3 броя", "en"), "Cart: 3 items");
  assert.equal(translate("Администрация", "en"), "Administration");
  assert.equal(translate("Администрация", "bg"), "Администрация");
  assert.equal(translate("Supplier SKU 123", "en"), "Supplier SKU 123");
});
test("English option labels preserve Bulgarian submitted business values", () => {
  const option = renderToStaticMarkup(
    localizeTree(createElement("option", null, "Автоаксесоари"), "en"),
  );
  assert.match(option, /value="Автоаксесоари"/);
  assert.match(option, />Car accessories</);
  const input = renderToStaticMarkup(
    localizeTree(
      createElement("input", {
        defaultValue: "Автоаксесоари",
        placeholder: "Имейл",
      }),
      "en",
    ),
  );
  assert.match(input, /value="Автоаксесоари"/);
  assert.match(input, /placeholder="Email"/);
});
