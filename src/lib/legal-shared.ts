// Legal page names and trader details (#45), safe for any component (no
// server imports). The texts themselves live in the database (legal.ts).

export const LEGAL_SLUGS = [
  "terms",
  "privacy",
  "delivery",
  "returns",
  "cookies",
] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const LEGAL_TITLES: Record<LegalSlug, [string, string]> = {
  terms: ["Общи условия", "Terms and conditions"],
  privacy: ["Политика за поверителност", "Privacy policy"],
  delivery: ["Доставка и плащане", "Delivery and payment"],
  returns: ["Връщане и отказ от поръчка", "Returns and withdrawal"],
  cookies: ["Бисквитки", "Cookies"],
};

export const isLegalSlug = (value: string): value is LegalSlug =>
  (LEGAL_SLUGS as readonly string[]).includes(value);

export type CompanyDetails = { label: [string, string]; value: string }[];

/** Trader details from COMPANY_* settings (only the configured ones). */
export function companyDetails(
  env: Partial<Record<string, string>> = process.env,
): CompanyDetails {
  const fields: [string, [string, string]][] = [
    ["COMPANY_NAME", ["Търговец", "Trader"]],
    ["COMPANY_REGISTRATION", ["ЕИК", "Company ID (EIK)"]],
    ["COMPANY_VAT", ["ДДС номер", "VAT number"]],
    ["COMPANY_ADDRESS", ["Адрес", "Address"]],
    ["COMPANY_EMAIL", ["Имейл", "Email"]],
    ["COMPANY_PHONE", ["Телефон", "Phone"]],
  ];
  return fields
    .map(([key, label]) => ({ label, value: env[key]?.trim() ?? "" }))
    .filter((field) => field.value);
}
