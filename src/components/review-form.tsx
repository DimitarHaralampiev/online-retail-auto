"use client";
// Review form for a verified buyer (#49); hidden for everyone else.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "./locale-provider";

type Eligibility = "can-review" | "already-reviewed" | "not-purchased" | null;

export default function ReviewForm({ sku }: { sku: string }) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const [eligibility, setEligibility] = useState<Eligibility | "loading">(
    "loading",
  );
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/products/${encodeURIComponent(sku)}/reviews`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => live && setEligibility(data?.eligibility ?? null))
      .catch(() => live && setEligibility(null));
    return () => {
      live = false;
    };
  }, [sku]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/products/${encodeURIComponent(sku)}/reviews`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rating, title, body }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? text("Неуспешно.", "Failed."));
        return;
      }
      setDone(data.message);
      setEligibility("already-reviewed");
    } catch {
      setError(text("Няма връзка.", "No connection."));
    } finally {
      setBusy(false);
    }
  }

  if (eligibility === "loading") return null;
  if (done) return <p role="status">{done}</p>;
  if (eligibility === null)
    return (
      <p className="note">
        <Link href="/account">{text("Влез в профила си", "Sign in")}</Link>
        {text(
          ", за да оставиш отзив за продукт, който си получил(а).",
          " to review a product you have received.",
        )}
      </p>
    );
  if (eligibility === "already-reviewed")
    return (
      <p className="note">
        {text(
          "Вече си оставил(а) отзив за този продукт.",
          "You have already reviewed this product.",
        )}
      </p>
    );
  if (eligibility === "not-purchased")
    return (
      <p className="note">
        {text(
          "Отзиви оставят само клиенти, получили продукта.",
          "Only customers who received this product can review it.",
        )}
      </p>
    );
  return (
    <form className="form-grid review-form" onSubmit={submit}>
      <fieldset className="full-width review-stars">
        <legend>{text("Оценка", "Rating")}</legend>
        {[1, 2, 3, 4, 5].map((value) => (
          <label key={value}>
            <input
              type="radio"
              name="rating"
              value={value}
              checked={rating === value}
              onChange={() => setRating(value)}
              required
            />
            {"★".repeat(value)}
            <span className="visually-hidden">
              {text(` ${value} от 5`, ` ${value} of 5`)}
            </span>
          </label>
        ))}
      </fieldset>
      <label className="full-width">
        {text("Заглавие (по избор)", "Title (optional)")}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
        />
      </label>
      <label className="full-width">
        {text("Отзив", "Review")}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          minLength={10}
          maxLength={4000}
          rows={5}
          required
        />
      </label>
      {error && (
        <p className="error full-width" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={busy || !rating}>
        {text("Изпрати отзива", "Submit review")}
      </button>
      <p className="note full-width">
        {text(
          "Отзивът се публикува след проверка. Показваме името ти съкратено (напр. „Иван П.“).",
          "Reviews are published after a check. Your name is shown shortened (e.g. “Ivan P.”).",
        )}
      </p>
    </form>
  );
}
