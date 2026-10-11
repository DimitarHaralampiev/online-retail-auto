import test from "node:test";
import assert from "node:assert/strict";
import { parseSpeedyPublicOffices } from "./speedy-public";
const row = (id: string, name: string, address: string) =>
  `<div id="${id}" class="divOffice"><b>${name}&nbsp;[${id}]</b><br><i>Адрес:</i><b>${address}</b></div>`;
test("public offices decode entities and use actual city rather than office branding", () => {
  const offices = parseSpeedyPublicOffices(
    row("1", "СОФИЯ - ЛОЗЕН", "с. Лозен [1151] ул. Тест No 3") +
      row("2", "ВАРНА &amp; ЦЕНТЪР", "гр. Варна [9000] ул. Тест No 1") +
      row("3", "ВАРНА (АВТОМАТ)", "гр. Варна [9000] ул. Тест No 2"),
  );
  assert.equal(offices.length, 2);
  assert.equal(offices[0].city, "Лозен");
  assert.equal(offices[1].city, "Варна");
  assert.ok(offices[1].name.includes("&"));
  assert.ok(!offices[1].name.includes("[2]"));
});
test("public offices recognize addresses without postcodes and known cities in industrial addresses", () => {
  const offices = parseSpeedyPublicOffices(
    row("1", "СТАРА ЗАГОРА", "гр. Стара Загора бул. Тест No 1") +
      row("2", "СТАРА ЗАГОРА - СКЛАД", "гр. Стара Загора ПТИЦЕКОМБИНАТ"),
  );
  assert.deepEqual(
    offices.map((o) => o.city),
    ["Стара Загора", "Стара Загора"],
  );
});
test("public parser rejects unknown cities, missing fields and duplicate identifiers", () => {
  assert.throws(() =>
    parseSpeedyPublicOffices(row("bad", "ОФИС", "гр. София [1000] ул. Тест")),
  );
  assert.throws(() =>
    parseSpeedyPublicOffices(row("1", "ОФИС", "непознат адрес")),
  );
  assert.throws(() =>
    parseSpeedyPublicOffices(
      row("1", "ОФИС", "гр. София [1000] ул. Тест").repeat(2),
    ),
  );
  assert.deepEqual(
    parseSpeedyPublicOffices("<html>Service unavailable</html>"),
    [],
  );
});
