"use client";
// Review moderation (#49): publish or reject reviews from verified buyers.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";

export type ModerationRow = {
  id: string;
  sku: string;
  status: "pending" | "published" | "rejected";
  authorName: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
};

export default function ReviewsAdmin({
  rows,
  status,
}: {
  rows: ModerationRow[];
  status: ModerationRow["status"];
}) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function moderate(id: string, action: "publish" | "reject") {
    setBusy(id);
    setError("");
    try {
      const response = await fetch(`/api/admin/reviews/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? text("Неуспешно.", "Failed."));
      } else router.refresh();
    } catch {
      setError(text("Няма връзка.", "No connection."));
    } finally {
      setBusy("");
    }
  }

  const tabs: [ModerationRow["status"], string, string][] = [
    ["pending", "Чакащи", "Pending"],
    ["published", "Публикувани", "Published"],
    ["rejected", "Отхвърлени", "Rejected"],
  ];
  return (
    <>
      <nav
        className="admin-product-actions"
        aria-label={text("Филтър", "Filter")}
      >
        {tabs.map(([value, bg, en]) => (
          <Link
            key={value}
            href={
              value === "pending"
                ? "/admin/reviews"
                : `/admin/reviews?status=${value}`
            }
            className="button"
            aria-current={value === status ? "page" : undefined}
          >
            {text(bg, en)}
          </Link>
        ))}
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!rows.length && <p>{text("Няма отзиви тук.", "No reviews here.")}</p>}
      <div className="admin-order-list">
        {rows.map((row) => (
          <article key={row.id} className="checkout-panel">
            <h2>
              {"★".repeat(row.rating)}
              {"☆".repeat(5 - row.rating)} {row.title}
            </h2>
            <p>{row.body}</p>
            <p className="note">
              {row.authorName} ·{" "}
              <Link href={`/catalog/${encodeURIComponent(row.sku)}`}>
                {row.sku}
              </Link>{" "}
              ·{" "}
              {new Date(row.createdAt).toLocaleString(
                locale === "en" ? "en-GB" : "bg-BG",
                {
                  timeZone: "Europe/Sofia",
                },
              )}
            </p>
            <div className="admin-product-actions">
              {row.status !== "published" && (
                <button
                  type="button"
                  className="button"
                  disabled={!!busy}
                  onClick={() => moderate(row.id, "publish")}
                >
                  {text("Публикувай", "Publish")}
                </button>
              )}
              {row.status !== "rejected" && (
                <button
                  type="button"
                  className="button"
                  disabled={!!busy}
                  onClick={() => moderate(row.id, "reject")}
                >
                  {text("Отхвърли", "Reject")}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
