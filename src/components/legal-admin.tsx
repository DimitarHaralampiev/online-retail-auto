"use client";
// Edits the business-supplied legal texts (#45). The shop never writes them.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";

export type LegalRow = {
  slug: string;
  title: [string, string];
  contentBg: string;
  contentEn: string;
  version: number;
};

export default function LegalAdmin({ pages }: { pages: LegalRow[] }) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const router = useRouter();
  const [slug, setSlug] = useState(pages[0]?.slug ?? "");
  const page = pages.find((p) => p.slug === slug)!;
  const [draft, setDraft] = useState({
    bg: page.contentBg,
    en: page.contentEn,
  });
  const [version, setVersion] = useState(page.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function open(next: LegalRow) {
    setSlug(next.slug);
    setDraft({ bg: next.contentBg, en: next.contentEn });
    setVersion(next.version);
    setError("");
    setNotice("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/legal/${slug}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version,
          contentBg: draft.bg,
          contentEn: draft.en,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? text("Неуспешно запазване.", "Saving failed."));
        return;
      }
      setVersion(data.page.version);
      setDraft({ bg: data.page.contentBg, en: data.page.contentEn });
      setNotice(text("Текстът е запазен.", "Text saved."));
      router.refresh();
    } catch {
      setError(text("Няма връзка.", "No connection."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-product-actions" role="tablist">
        {pages.map((p) => (
          <button
            key={p.slug}
            type="button"
            role="tab"
            aria-selected={p.slug === slug}
            className="button"
            onClick={() => open(p)}
          >
            {text(...p.title)} {p.contentBg.trim() ? "✓" : "—"}
          </button>
        ))}
      </div>
      <form className="checkout-panel admin-product-form" onSubmit={save}>
        <h2>{text(...page.title)}</h2>
        <p className="note">
          {text(
            "Формат: # Заглавие, ## Подзаглавие, - точка от списък, 1. номериран списък, **удебелен**, [текст](https://…). Празен текст = страницата показва, че още не е публикувана.",
            "Format: # Heading, ## Subheading, - bullet, 1. numbered item, **bold**, [text](https://…). Empty text = the page says it is not published yet.",
          )}{" "}
          <Link href={`/legal/${slug}`} target="_blank">
            {text("Преглед →", "Preview →")}
          </Link>
        </p>
        <label>
          {text("Текст на български", "Bulgarian text")}
          <textarea
            value={draft.bg}
            onChange={(e) => setDraft({ ...draft, bg: e.target.value })}
            rows={18}
            maxLength={100_000}
          />
        </label>
        <label>
          {text("Текст на английски (по избор)", "English text (optional)")}
          <textarea
            value={draft.en}
            onChange={(e) => setDraft({ ...draft, en: e.target.value })}
            rows={12}
            maxLength={100_000}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p role="status">{notice}</p>
        <button type="submit" className="button" disabled={busy}>
          {text("Запази", "Save")}
        </button>
      </form>
    </>
  );
}
