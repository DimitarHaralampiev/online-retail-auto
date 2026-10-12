import english from "./en.json";
import type { Locale } from "./locale";
const dictionary: Record<string, string> = english;
export function translate(text: string, locale: Locale): string {
  if (locale === "bg" || !/[А-Яа-я]/u.test(text)) return text;
  const key = text.replace(/\s+/g, " ").trim();
  const exact = dictionary[key];
  if (exact)
    return (
      (text.match(/^\s*/)?.[0] ?? "") + exact + (text.match(/\s*$/)?.[0] ?? "")
    );
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^Количка: (\d+) броя$/, (m) => `Cart: ${m[1]} items`],
    [/^Демо намаление (\d+) процента$/, (m) => `Demo discount ${m[1]} percent`],
    [/^Запазена доставка: (.+)\.$/, (m) => `Saved delivery: ${m[1]}.`],
    [/^Разгледай (.+)$/, (m) => `View ${translate(m[1], locale)}`],
    [/^Илюстрация: (.+)$/, (m) => `Illustration: ${translate(m[1], locale)}`],
    [
      /^Премахни от любими: (.+)$/,
      (m) => `Remove from favorites: ${translate(m[1], locale)}`,
    ],
    [
      /^Добави в любими: (.+)$/,
      (m) => `Add to favorites: ${translate(m[1], locale)}`,
    ],
    [/^Премахни (.+)$/, (m) => `Remove ${translate(m[1], locale)}`],
    [/^Бройки за (.+)$/, (m) => `Quantity for ${translate(m[1], locale)}`],
    [/^Пропуснати: (.+)\.$/, (m) => `Skipped: ${m[1]}.`],
    [
      /^Ограничени до наличността: (.+)\.$/,
      (m) => `Limited to available stock: ${m[1]}.`,
    ],
    [
      /^(.+) тестова доставка · (.+) общо$/,
      (m) => `${m[1]} test shipping · ${m[2]} total`,
    ],
  ];
  for (const [pattern, render] of patterns) {
    const match = key.match(pattern);
    if (match) return render(match);
  }
  return text;
}
