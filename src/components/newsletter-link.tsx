"use client";
// Confirm or unsubscribe from the emailed link (#50). The token arrives in
// the URL fragment; the action runs only on a click, so link scanners in
// mailboxes cannot confirm or unsubscribe on their own.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "./locale-provider";

export default function NewsletterLink({
  action,
}: {
  action: "confirm" | "unsubscribe";
}) {
  const { locale, t } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    setToken(new URLSearchParams(location.hash.slice(1)).get("token") ?? "");
    history.replaceState(history.state, "", location.pathname);
  }, []);
  async function run() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        setError(data.error ? t(data.error) : text("Неуспешно.", "Failed."));
      else {
        setMessage(t(data.message));
        setToken("");
      }
    } catch {
      setError(text("Няма връзка.", "No connection."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="checkout-panel account-panel">
      <h2>
        {action === "confirm"
          ? text("Потвърди абонамента", "Confirm your subscription")
          : text("Отписване от новините", "Unsubscribe from news")}
      </h2>
      {token && (
        <button type="button" className="button" disabled={busy} onClick={run}>
          {action === "confirm"
            ? text("Потвърждавам абонамента", "Confirm subscription")
            : text("Отпиши ме", "Unsubscribe me")}
        </button>
      )}
      {!token && !message && (
        <p>
          {text(
            "Липсва линк. Отвори линка от имейла.",
            "The link is missing. Open the link from the email.",
          )}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status">
          {message}{" "}
          <Link href="/">{text("Към магазина →", "To the shop →")}</Link>
        </p>
      )}
    </section>
  );
}
