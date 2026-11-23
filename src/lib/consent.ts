// Cookie consent (#46). Necessary cookies (session, language, chosen car,
// cart) need no consent: they serve features the visitor uses. Anything
// else belongs to a consent category and may only load after the visitor
// agreed (ConsentGate). With no non-essential service configured there is
// nothing to ask, so no banner is shown.

import { fieldVitalsEnabled } from "./client-reports";

export const CONSENT_COOKIE = "auto_consent";
/** Bump when categories change: older choices are asked again. */
export const CONSENT_VERSION = 1;
/** Six months, after which the visitor is asked again. */
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 182;

export const CONSENT_CATEGORIES = ["analytics", "marketing"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export type Consent = {
  version: number;
  analytics: boolean;
  marketing: boolean;
  /** When the choice was made (ISO), for the consent record. */
  at: string;
};

export function parseConsent(value: string | undefined): Consent | null {
  if (!value) return null;
  try {
    const data = JSON.parse(decodeURIComponent(value));
    if (
      data?.version !== CONSENT_VERSION ||
      typeof data.analytics !== "boolean" ||
      typeof data.marketing !== "boolean" ||
      typeof data.at !== "string" ||
      Number.isNaN(Date.parse(data.at))
    )
      return null;
    return {
      version: CONSENT_VERSION,
      analytics: data.analytics,
      marketing: data.marketing,
      at: data.at,
    };
  } catch {
    return null;
  }
}

export function serializeConsent(
  choice: Record<ConsentCategory, boolean>,
  now = new Date(),
): string {
  return encodeURIComponent(
    JSON.stringify({
      version: CONSENT_VERSION,
      ...choice,
      at: now.toISOString(),
    }),
  );
}

/**
 * Consent categories used by configured services. ANALYTICS_PROVIDER (for
 * example "plausible") or FIELD_VITALS=1 turns on the analytics category;
 * until a service is configured, the list is empty and no banner appears.
 */
export function consentCategoriesInUse(
  env: Partial<Record<string, string>> = process.env,
): ConsentCategory[] {
  const categories: ConsentCategory[] = [];
  if (env.ANALYTICS_PROVIDER?.trim() || fieldVitalsEnabled(env))
    categories.push("analytics");
  if (env.MARKETING_PROVIDER?.trim()) categories.push("marketing");
  return categories;
}

/** Whether `category` may load: only with a stored, explicit yes. */
export const allowed = (consent: Consent | null, category: ConsentCategory) =>
  !!consent && consent[category];
