import { load } from "cheerio";
import type { Office } from "./delivery";
export const speedyPublicUrl =
  "https://services.speedy.bg/office_locator_widget_v2/offices_list.php?lang=bg&countryId=100";
// Public HTML from Speedy's own office locator. Parse data only; never run its scripts.
export function parseSpeedyPublicOffices(html: string): Office[] {
  const $ = load(html);
  const rows: { id: string; title: string; address: string; city?: string }[] =
    [];
  $(".divOffice").each((_, element) => {
    const row = $(element);
    const id = row.attr("id") ?? "";
    const bold = row.find("b");
    const title = bold.eq(0).text().replace(/\s+/g, " ").trim();
    const address = bold.eq(1).text().replace(/\s+/g, " ").trim();
    if (/\(АВТОМАТ\)/i.test(title)) return;
    if (!/^\d+$/.test(id) || !title || !address)
      throw new Error("Speedy public list format changed");
    const city = address
      .match(
        /^(?:гр\.|с\.|к\.к\.|к\.)\s*(.+?)(?=\s+(?:\[\d+\]|ул\.|бул\.|жк(?:\s|$)|кв\.|пл\.|м-ст(?:\s|$)))/iu,
      )?.[1]
      ?.trim();
    rows.push({ id, title, address, city });
  });
  const cities = [
    ...new Set(rows.flatMap((row) => (row.city ? [row.city] : []))),
  ].sort((a, b) => b.length - a.length);
  const ids = new Set<string>();
  return rows.map((row) => {
    const addressWithoutType = row.address.replace(
      /^(?:гр\.|с\.|к\.к\.|к\.)\s*/u,
      "",
    );
    const city =
      row.city ??
      cities.find((candidate) =>
        addressWithoutType.startsWith(candidate + " "),
      );
    if (!city || ids.has(row.id))
      throw new Error("Speedy public list format changed");
    ids.add(row.id);
    return {
      id: row.id,
      courier: "speedy",
      city,
      name: `${row.title.replace(/\s*\[\d+\]$/, "")} — ${row.address}`,
    };
  });
}
export async function publicSpeedyOffices(): Promise<Office[]> {
  const response = await fetch(speedyPublicUrl, {
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "Не успяхме да заредим публичния списък на Спиди. Опитай отново или избери доставка до адрес.",
    );
  const offices = parseSpeedyPublicOffices(await response.text());
  if (offices.length < 100)
    throw new Error(
      "Публичният списък на Спиди временно не е достъпен. Опитай отново или избери доставка до адрес.",
    );
  return offices;
}
