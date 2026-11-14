import assert from "node:assert/strict";
import { test } from "node:test";
import { CsvError, parseCsv } from "./csv";

test("parses comma CSV with quotes, escaped quotes and embedded breaks", () => {
  const table = parseCsv(
    'SKU,Name,Description\r\nA-1,"Filter, air","Line one\r\nline ""two"""\r\nA-2,Pads,\r\n',
  );
  assert.equal(table.delimiter, ",");
  assert.deepEqual(table.header, ["sku", "name", "description"]);
  assert.deepEqual(table.rows, [
    { line: 2, cells: ["A-1", "Filter, air", 'Line one\r\nline "two"'] },
    { line: 4, cells: ["A-2", "Pads", ""] },
  ]);
});

test("detects semicolons (Bulgarian Excel) and strips a BOM", () => {
  const table = parseCsv("﻿sku;price\nA-1;12,50\n\nA-2;3\n");
  assert.equal(table.delimiter, ";");
  assert.deepEqual(table.header, ["sku", "price"]);
  assert.deepEqual(
    table.rows.map((r) => [r.line, r.cells]),
    [
      [2, ["A-1", "12,50"]],
      [4, ["A-2", "3"]],
    ],
  );
});

test("a delimiter inside quotes in the header does not win detection", () => {
  assert.equal(parseCsv('"a;b",c\n1,2').delimiter, ",");
  assert.equal(parseCsv("a\tb\n1\t2").delimiter, "\t");
});

test("handles a last line without newline and CR-only endings", () => {
  assert.deepEqual(
    parseCsv("a,b\r1,2\r3,4").rows.map((r) => r.cells),
    [
      ["1", "2"],
      ["3", "4"],
    ],
  );
});

test("rejects empty files, unterminated quotes, junk after quotes and too many rows", () => {
  assert.throws(() => parseCsv("  \n "), CsvError);
  assert.throws(() => parseCsv('a,b\n1,"open'), /незатворени/);
  assert.throws(() => parseCsv('a,b\n"x"y,2'), /разделител/);
  assert.throws(() => parseCsv("a\n1\n2\n3", 2), /над 2 реда/);
  assert.equal(parseCsv("a\n1\n2", 2).rows.length, 2);
});
