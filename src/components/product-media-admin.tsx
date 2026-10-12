"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "./locale-provider";
type Product = { sku: string; name: string; on_hand: number };
type Media = {
  id: string;
  kind: "image" | "video";
  filename: string;
  mime_type: string;
  is_primary: boolean;
  bytes: number;
  alt_text: { bg: string; en: string };
};
function MediaCard({
  item,
  index,
  count,
  busy,
  onAction,
}: {
  item: Media;
  index: number;
  count: number;
  busy: boolean;
  onAction: (
    id: string,
    action: string,
    alt?: { bg: string; en: string },
  ) => Promise<void>;
}) {
  const { locale } = useLocale();
  const en = locale === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const [alt, setAlt] = useState(item.alt_text);
  useEffect(() => setAlt(item.alt_text), [item.alt_text]);
  return (
    <article className="media-card">
      <div className="media-preview">
        {item.kind === "image" ? (
          <img
            src={`/api/admin/products/media/${item.id}`}
            alt={alt[locale] || item.filename}
          />
        ) : (
          <video
            src={`/api/admin/products/media/${item.id}`}
            controls
            preload="metadata"
            aria-label={alt[locale] || item.filename}
          />
        )}
        {item.is_primary && (
          <span className="media-primary-badge">
            {text("Основна снимка", "Cover image")}
          </span>
        )}
      </div>
      <div className="media-card-body">
        <h3 title={item.filename}>{item.filename}</h3>
        <p className="media-file-info">
          {item.kind === "image"
            ? text("Снимка", "Image")
            : text("Видео", "Video")}{" "}
          · {(item.bytes / 1024 / 1024).toFixed(2)} MB
        </p>
        <div className="media-order-actions">
          <button
            type="button"
            disabled={busy || index === 0}
            onClick={() => onAction(item.id, "up")}
            aria-label={
              text("Премести напред", "Move earlier") + ": " + item.filename
            }
          >
            ←
          </button>
          <span>
            {index + 1} / {count}
          </span>
          <button
            type="button"
            disabled={busy || index === count - 1}
            onClick={() => onAction(item.id, "down")}
            aria-label={
              text("Премести назад", "Move later") + ": " + item.filename
            }
          >
            →
          </button>
          {item.kind === "image" && !item.is_primary && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(item.id, "primary")}
            >
              {text("Направи основна", "Set as cover")}
            </button>
          )}
        </div>
        <details>
          <summary>
            {text("Описание на BG / EN", "Description in BG / EN")}
          </summary>
          <label>
            BG
            <input
              maxLength={500}
              value={alt.bg}
              onChange={(e) => setAlt({ ...alt, bg: e.target.value })}
              disabled={busy}
            />
          </label>
          <label>
            EN
            <input
              maxLength={500}
              value={alt.en}
              onChange={(e) => setAlt({ ...alt, en: e.target.value })}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => onAction(item.id, "alt", alt)}
          >
            {text("Запази описанието", "Save description")}
          </button>
        </details>
        <button
          type="button"
          className="media-remove"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                text("Да изтрия ли този файл?", "Delete this file?"),
              )
            )
              void onAction(item.id, "remove");
          }}
        >
          {text("Изтрий файла", "Delete file")}
        </button>
      </div>
    </article>
  );
}
export default function ProductMediaAdmin({
  products,
  initialSku,
}: {
  products: Product[];
  initialSku: string;
}) {
  const { locale, t } = useLocale();
  const en = locale === "en";
  const text = (bg: string, english: string) => (en ? english : bg);
  const [sku, setSku] = useState(initialSku || products[0]?.sku || "");
  const [media, setMedia] = useState<Media[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [inputKey, setInputKey] = useState(0);
  async function list(signal?: AbortSignal) {
    const r = await fetch(
      `/api/admin/products/media?sku=${encodeURIComponent(sku)}`,
      { signal, cache: "no-store" },
    );
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    return data.media as Media[];
  }
  useEffect(() => {
    if (!sku) return;
    const controller = new AbortController();
    setLoading(true);
    setMedia([]);
    setError("");
    setMessage("");
    list(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setMedia(items);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [sku]);
  async function action(
    id: string,
    action: string,
    alt?: { bg: string; en: string },
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/products/media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, sku, action, ...(alt ? { alt } : {}) }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setMedia(await list());
      setMessage(text("Промяната е запазена.", "Changes saved."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    let done = 0;
    try {
      for (const file of files) {
        const form = new FormData();
        form.set("sku", sku);
        form.set("file", file);
        const r = await fetch("/api/admin/products/media", {
          method: "POST",
          body: form,
        });
        const data = await r.json();
        if (!r.ok) throw Error(data.error);
        done++;
      }
      setMessage(text(`Качени файлове: ${done}.`, `Uploaded files: ${done}.`));
    } catch (e) {
      setError(
        text(`Успешно качени: ${done}. `, `Successfully uploaded: ${done}. `) +
          t((e as Error).message),
      );
    } finally {
      try {
        setMedia(await list());
      } catch (e) {
        setError((e as Error).message);
      }
      setFiles([]);
      setInputKey((k) => k + 1);
      setBusy(false);
    }
  }
  const product = products.find((p) => p.sku === sku);
  const filtered = products.filter((p) =>
    (p.name + " " + p.sku).toLowerCase().includes(search.toLowerCase()),
  );
  if (!products.length)
    return (
      <section className="checkout-panel">
        <h2>
          {text(
            "Първо добави артикул в склада.",
            "Add a warehouse product first.",
          )}
        </h2>
        <p>
          {text(
            "Качи и заприходи фактура. После избери артикул тук, за да добавиш неговите снимки и видеа.",
            "Upload and receive an invoice. Then select an item here to add its photos and videos.",
          )}
        </p>
        <Link className="button" href="/admin/invoices">
          {text("Към фактурите", "Go to invoices")}
        </Link>
      </section>
    );
  return (
    <div className="product-media-workspace">
      <aside className="media-product-list">
        <label>
          {text("Намери артикул", "Find an item")}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={text("Име или SKU", "Name or SKU")}
            disabled={busy}
          />
        </label>
        <div
          role="group"
          aria-label={text("Складови артикули", "Warehouse products")}
        >
          {filtered.map((p) => (
            <button
              type="button"
              key={p.sku}
              aria-pressed={sku === p.sku}
              disabled={busy}
              onClick={() => {
                setSku(p.sku);
                setFiles([]);
                setInputKey((k) => k + 1);
              }}
            >
              <strong>{p.name}</strong>
              <span>
                {p.sku} · {p.on_hand} {text("бр.", "units")}
              </span>
            </button>
          ))}
        </div>
        {!filtered.length && <p>{text("Няма съвпадения.", "No matches.")}</p>}
      </aside>
      <section className="media-content">
        <header className="media-product-heading">
          <p className="eyebrow">{product?.sku}</p>
          <h2>{product?.name}</h2>
          <p>
            {text(
              "Подреди галерията и избери снимката, която представя продукта.",
              "Arrange the gallery and choose the image that represents the product.",
            )}
          </p>
        </header>
        <form className="media-upload-box" onSubmit={upload}>
          <label htmlFor="product-media-files">
            <strong>
              {text("Добави снимки или видео", "Add photos or video")}
            </strong>
            <span>JPG / PNG / WebP · MP4 / WebM</span>
          </label>
          <input
            key={inputKey}
            id="product-media-files"
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            multiple
            disabled={busy || loading}
            required
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
          <p>
            {text(
              "Снимка до 10 MB · Видео до 50 MB · До 12 файла и общо 100 MB на артикул.",
              "Image up to 10 MB · Video up to 50 MB · Up to 12 files and 100 MB per item.",
            )}
          </p>
          <button
            className="button"
            disabled={busy || loading || !files.length}
          >
            {busy
              ? text("Запазваме…", "Saving…")
              : text("Качи избраните файлове", "Upload selected files")}
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {t(error)}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <div className="media-gallery-heading">
          <h3>{text("Галерия", "Gallery")}</h3>
          <span>{media.length} / 12</span>
        </div>
        {loading ? (
          <p role="status">{text("Зареждаме файловете…", "Loading files…")}</p>
        ) : (
          <div className="media-gallery">
            {media.map((item, index) => (
              <MediaCard
                key={item.id}
                item={item}
                index={index}
                count={media.length}
                busy={busy}
                onAction={action}
              />
            ))}
          </div>
        )}
        {!loading && !media.length && (
          <p className="media-empty">
            {text(
              "Все още няма снимки или видео за този артикул.",
              "No photos or video for this item yet.",
            )}
          </p>
        )}
        <p className="note">
          {text(
            "Файловете са в административния склад. Качването не публикува продукта автоматично във витрината.",
            "Files belong to the administrative warehouse. Uploading does not automatically publish the product to the storefront.",
          )}
        </p>
      </section>
    </div>
  );
}
