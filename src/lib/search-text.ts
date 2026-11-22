// Search text normalisation shared by browser and server code. latinize()
// mirrors the SQL function search_latin (migration 017) so suggestions
// computed in JavaScript match what the database search matches.

const MULTI: [string, string][] = [
  ["щ", "sht"],
  ["ж", "zh"],
  ["ч", "ch"],
  ["ш", "sh"],
  ["ю", "yu"],
  ["я", "ya"],
  ["ц", "ts"],
  ["х", "h"],
];
const SINGLE_FROM = "абвгдезийклмнопрстуфъьѝ";
const SINGLE_TO = "abvgdeziyklmnoprstufayi";

/** Lower-case Latin: Bulgarian Cyrillic transliterated, accents removed. */
export function latinize(value: string): string {
  let text = value.toLowerCase();
  for (const [from, to] of MULTI) text = text.replaceAll(from, to);
  let out = "";
  for (const char of text) {
    const index = SINGLE_FROM.indexOf(char);
    out += index >= 0 ? SINGLE_TO[index] : char;
  }
  return out.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Facet key of a brand ("Bosch Car Service" → "bosch-car-service"). */
export function brandKey(brand: string): string {
  return latinize(brand)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
