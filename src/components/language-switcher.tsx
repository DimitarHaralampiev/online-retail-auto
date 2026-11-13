"use client";
import { useLocale } from "./locale-provider";
export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="language-switcher" role="group" aria-label={t("Език")}>
      <button
        type="button"
        lang="bg"
        aria-label="BG — Български"
        aria-pressed={locale === "bg"}
        onClick={() => setLocale("bg")}
      >
        BG
      </button>
      <button
        type="button"
        lang="en"
        aria-label="EN — English"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        EN
      </button>
    </div>
  );
}
