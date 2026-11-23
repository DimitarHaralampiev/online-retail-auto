"use client";
// Footer newsletter sign-up (#50): email plus an explicit consent checkbox;
// the subscription starts only after the emailed link is opened.
import { useState } from "react";
import { useLocale } from "./locale-provider";
import { CONSENT_TEXT } from "../lib/newsletter-text";

export default function NewsletterForm() {
  const { locale, t } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "subscribe", email, consent, locale }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        setError(data.error ? t(data.error) : text("Неуспешно.", "Failed."));
      else {
        setMessage(t(data.message));
        setEmail("");
        setConsent(false);
      }
    } catch {
      setError(text("Няма връзка.", "No connection."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="newsletter-form" onSubmit={submit}>
      <span className="eyebrow">{text("НОВИНИ", "NEWS")}</span>
      <label>
        {text("Имейл за новини", "Email for news")}
        <input
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="newsletter-consent">
        <input
          type="checkbox"
          required
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>{CONSENT_TEXT[locale]}</span>
      </label>
      <button type="submit" className="button" disabled={busy}>
        {text("Абонирай се", "Subscribe")}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p role="status">{message}</p>
    </form>
  );
}
