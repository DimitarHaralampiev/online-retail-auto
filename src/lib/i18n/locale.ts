export const locales = ["bg", "en"] as const;
export type Locale = (typeof locales)[number];
export const LOCALE_COOKIE = "auto_locale";
export function parseLocale(value: unknown): Locale {
  return value === "en" ? "en" : "bg";
}
export function localeFromCookie(cookie: string) {
  return parseLocale(
    cookie
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(LOCALE_COOKIE + "="))
      ?.slice(LOCALE_COOKIE.length + 1),
  );
}
