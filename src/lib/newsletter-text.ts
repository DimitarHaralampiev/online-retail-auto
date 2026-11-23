// Newsletter consent wording (#50), shown in the form and stored with each
// subscription. Safe for client components.
import type { Locale } from "./i18n/locale";

/** The consent the visitor gives, stored with the subscription. */
export const CONSENT_TEXT: Record<Locale, string> = {
  bg: "Искам да получавам по имейл новини и промоции от AUTO/SHOP. Мога да се отпиша по всяко време чрез линка във всеки имейл.",
  en: "I want to receive news and promotions from AUTO/SHOP by email. I can unsubscribe at any time through the link in every email.",
};
