"use client";
// Cookie consent (#46): the visitor's choice, the banner that asks for it
// (only when non-essential services are configured) and ConsentGate, which
// renders non-essential scripts only after an explicit yes.
import Link from "next/link";
import { createContext, useContext, useState } from "react";
import { useLocale } from "./locale-provider";
import {
  allowed,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE,
  parseConsent,
  serializeConsent,
  type Consent,
  type ConsentCategory,
} from "../lib/consent";

type Context = {
  consent: Consent | null;
  categories: ConsentCategory[];
  choose: (choice: Record<ConsentCategory, boolean>) => void;
  openSettings: () => void;
};
const ConsentContext = createContext<Context>({
  consent: null,
  categories: [],
  choose: () => {},
  openSettings: () => {},
});
export const useConsent = () => useContext(ConsentContext);

const LABELS: Record<ConsentCategory, [string, string, string, string]> = {
  analytics: [
    "Анализ",
    "Analytics",
    "Помагат ни да разберем как се използва магазинът.",
    "Help us understand how the shop is used.",
  ],
  marketing: [
    "Маркетинг",
    "Marketing",
    "Използват се за реклами и измерване на кампании.",
    "Used for advertising and measuring campaigns.",
  ],
};

export default function ConsentProvider({
  initialConsent,
  categories,
  children,
}: {
  /** The cookie as read on the server, so the first render is correct. */
  initialConsent: string | undefined;
  /** Consent categories of configured services (empty: no banner). */
  categories: ConsentCategory[];
  children: React.ReactNode;
}) {
  const [consent, setConsent] = useState(() => parseConsent(initialConsent));
  const [open, setOpen] = useState(false);
  function choose(choice: Record<ConsentCategory, boolean>) {
    const value = serializeConsent(choice);
    document.cookie = `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    setConsent(parseConsent(value));
    setOpen(false);
  }
  return (
    <ConsentContext.Provider
      value={{ consent, categories, choose, openSettings: () => setOpen(true) }}
    >
      {children}
      {categories.length > 0 && (!consent || open) && (
        <ConsentBanner
          categories={categories}
          consent={consent}
          detailed={open}
          onChoose={choose}
        />
      )}
    </ConsentContext.Provider>
  );
}

function ConsentBanner({
  categories,
  consent,
  detailed,
  onChoose,
}: {
  categories: ConsentCategory[];
  consent: Consent | null;
  detailed: boolean;
  onChoose: (choice: Record<ConsentCategory, boolean>) => void;
}) {
  const { locale } = useLocale();
  const en = locale === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const [settings, setSettings] = useState(detailed);
  const [choice, setChoice] = useState<Record<ConsentCategory, boolean>>({
    analytics: consent?.analytics ?? false,
    marketing: consent?.marketing ?? false,
  });
  const all = (value: boolean) =>
    Object.fromEntries(
      (["analytics", "marketing"] as const).map((c) => [
        c,
        value && categories.includes(c),
      ]),
    ) as Record<ConsentCategory, boolean>;
  return (
    <section
      className="consent-banner"
      role="region"
      aria-label={text("Бисквитки", "Cookies")}
    >
      <p>
        {text(
          "Използваме необходими бисквитки, за да работи магазинът. С твое съгласие бихме използвали и бисквитки за:",
          "We use necessary cookies to run the shop. With your consent we would also use cookies for:",
        )}{" "}
        {categories.map((c) => text(LABELS[c][0], LABELS[c][1])).join(", ")}.{" "}
        <Link href="/legal/cookies">{text("Научи повече", "Learn more")}</Link>
      </p>
      {settings && (
        <fieldset className="consent-options">
          <legend>{text("Избери категории", "Choose categories")}</legend>
          <label>
            <input type="checkbox" checked disabled />
            {text("Необходими (винаги включени)", "Necessary (always on)")}
          </label>
          {categories.map((category) => (
            <label key={category}>
              <input
                type="checkbox"
                checked={choice[category]}
                onChange={(e) =>
                  setChoice({ ...choice, [category]: e.target.checked })
                }
              />
              {text(LABELS[category][0], LABELS[category][1])} —{" "}
              {text(LABELS[category][2], LABELS[category][3])}
            </label>
          ))}
        </fieldset>
      )}
      <div className="consent-actions">
        {/* Accepting and refusing are equally easy (same style, one click). */}
        <button
          type="button"
          className="button"
          onClick={() => onChoose(all(true))}
        >
          {text("Приемам всички", "Accept all")}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => onChoose(all(false))}
        >
          {text("Само необходимите", "Necessary only")}
        </button>
        {settings ? (
          <button
            type="button"
            className="button"
            onClick={() => onChoose(choice)}
          >
            {text("Запази избора", "Save my choice")}
          </button>
        ) : (
          <button
            type="button"
            className="text-link"
            onClick={() => setSettings(true)}
          >
            {text("Настройки", "Settings")}
          </button>
        )}
      </div>
    </section>
  );
}

/** Renders non-essential content (e.g. an analytics script) only with consent. */
export function ConsentGate({
  category,
  children,
}: {
  category: ConsentCategory;
  children: React.ReactNode;
}) {
  const { consent } = useConsent();
  return allowed(consent, category) ? <>{children}</> : null;
}

/** Footer button that reopens the choice. */
export function ConsentSettingsButton() {
  const { categories, openSettings } = useConsent();
  const { locale } = useLocale();
  if (!categories.length) return null;
  return (
    <button type="button" className="text-link" onClick={openSettings}>
      {locale === "en" ? "Cookie settings" : "Настройки за бисквитки"}
    </button>
  );
}
