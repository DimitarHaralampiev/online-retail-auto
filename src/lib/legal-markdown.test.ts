import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseLegalMarkdown } from "./legal-markdown";

test("headings, paragraphs and lists", () => {
  assert.deepEqual(
    parseLegalMarkdown(
      "# Общи\nПърви ред\nвтори ред\n\n## Права\n- едно\n- две\n1. първо\n2) второ\nКрай",
    ),
    [
      { type: "heading", level: 2, content: [{ type: "text", text: "Общи" }] },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Първи ред втори ред" }],
      },
      { type: "heading", level: 3, content: [{ type: "text", text: "Права" }] },
      {
        type: "list",
        ordered: false,
        items: [
          [{ type: "text", text: "едно" }],
          [{ type: "text", text: "две" }],
        ],
      },
      {
        type: "list",
        ordered: true,
        items: [
          [{ type: "text", text: "първо" }],
          [{ type: "text", text: "второ" }],
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "Край" }] },
    ],
  );
});

test("bold and safe links only", () => {
  assert.deepEqual(
    parseInline(
      "Виж **важно** и [ОРС](https://ec.europa.eu/consumers/odr) или [пиши](mailto:a@b.bg)",
    ),
    [
      { type: "text", text: "Виж " },
      { type: "strong", text: "важно" },
      { type: "text", text: " и " },
      { type: "link", text: "ОРС", href: "https://ec.europa.eu/consumers/odr" },
      { type: "text", text: " или " },
      { type: "link", text: "пиши", href: "mailto:a@b.bg" },
    ],
  );
  for (const href of [
    "javascript:alert(1)",
    "http://plain.example",
    "data:text/html,x",
    "//evil.example",
  ]) {
    const parts = parseInline(`[x](${href})`);
    assert.ok(
      parts.every((part) => part.type !== "link"),
      href,
    );
    assert.equal(parts[0].text, "x");
  }
});

test("markup is text, not HTML", () => {
  assert.deepEqual(parseLegalMarkdown("<script>alert(1)</script>"), [
    {
      type: "paragraph",
      content: [{ type: "text", text: "<script>alert(1)</script>" }],
    },
  ]);
  assert.deepEqual(parseLegalMarkdown("   \n\n"), []);
});
