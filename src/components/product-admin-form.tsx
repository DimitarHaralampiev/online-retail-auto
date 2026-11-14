"use client";
// Create or edit one product. The server validates everything again; this
// form only converts euros and percentages to cents and basis points.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";
import {
  parseEuros,
  STATUS_LABELS,
  type ProductStatus,
} from "../lib/admin-product-shared";

export type EditableProduct = {
  sku: string;
  name: { bg: string; en: string };
  description: { bg: string; en: string };
  categoryId: string | null;
  brand: string;
  manufacturerCode: string;
  ean: string;
  priceCents: number | null;
  vatBps: number;
  imagePath: string | null;
  weightGrams: number | null;
  status: ProductStatus;
  version: number;
};

export type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
  active: boolean;
};

type Fields = {
  sku: string;
  nameBg: string;
  nameEn: string;
  descriptionBg: string;
  descriptionEn: string;
  categoryId: string;
  brand: string;
  manufacturerCode: string;
  ean: string;
  price: string;
  vat: string;
  imagePath: string;
  weight: string;
};

const fieldsOf = (p: EditableProduct | null): Fields => ({
  sku: p?.sku ?? "",
  nameBg: p?.name.bg ?? "",
  nameEn: p?.name.en ?? "",
  descriptionBg: p?.description.bg ?? "",
  descriptionEn: p?.description.en ?? "",
  categoryId: p?.categoryId ?? "",
  brand: p?.brand ?? "",
  manufacturerCode: p?.manufacturerCode ?? "",
  ean: p?.ean ?? "",
  price: p?.priceCents == null ? "" : (p.priceCents / 100).toFixed(2),
  vat: String((p?.vatBps ?? 2000) / 100),
  imagePath: p?.imagePath ?? "",
  weight: p?.weightGrams == null ? "" : String(p.weightGrams),
});

export default function ProductAdminForm({
  product: initial,
  categories,
}: {
  product: EditableProduct | null;
  categories: CategoryOption[];
}) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const router = useRouter();
  const [product, setProduct] = useState(initial);
  const [fields, setFields] = useState(() => fieldsOf(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const set =
    (key: keyof Fields) =>
    (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      setFields((current) => ({ ...current, [key]: event.target.value }));

  async function send(url: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? text("Неуспешно запазване.", "Saving failed."));
        return null;
      }
      return data.product as EditableProduct;
    } catch {
      setError(
        text("Няма връзка. Опитай отново.", "No connection. Try again."),
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const priceCents = parseEuros(fields.price);
    const vat = Number(fields.vat.replace(",", "."));
    const weight = fields.weight.trim() ? Number(fields.weight) : null;
    if (Number.isNaN(priceCents))
      return setError(
        text(
          "Цената трябва да е сума в евро, напр. 45,90.",
          "The price must be an amount in euros, e.g. 45.90.",
        ),
      );
    if (!Number.isFinite(vat))
      return setError(text("Невалидно ДДС.", "Invalid VAT."));
    const body = {
      name: { bg: fields.nameBg, en: fields.nameEn },
      description: { bg: fields.descriptionBg, en: fields.descriptionEn },
      categoryId: fields.categoryId || null,
      brand: fields.brand,
      manufacturerCode: fields.manufacturerCode,
      ean: fields.ean,
      priceCents,
      vatBps: Math.round(vat * 100),
      imagePath: fields.imagePath.trim() || null,
      weightGrams: weight,
    };
    if (!product) {
      const created = await send("/api/admin/catalog/products", "POST", {
        ...body,
        sku: fields.sku,
      });
      if (created)
        router.replace(
          `/admin/products/edit?sku=${encodeURIComponent(created.sku)}&created=1`,
        );
      return;
    }
    const saved = await send(
      `/api/admin/catalog/products/${encodeURIComponent(product.sku)}`,
      "PUT",
      { ...body, version: product.version },
    );
    if (saved) {
      setProduct(saved);
      setFields(fieldsOf(saved));
      setNotice(text("Промените са запазени.", "Changes saved."));
      router.refresh();
    }
  }

  async function changeStatus(status: ProductStatus) {
    if (!product) return;
    const saved = await send(
      `/api/admin/catalog/products/${encodeURIComponent(product.sku)}/status`,
      "POST",
      { status, version: product.version },
    );
    if (saved) {
      setProduct(saved);
      setNotice(
        text("Статус: ", "Status: ") + text(...STATUS_LABELS[saved.status]),
      );
      router.refresh();
    }
  }

  const tops = categories.filter((c) => !c.parentId);
  return (
    <form className="checkout-panel admin-product-form" onSubmit={save}>
      {product && (
        <div className="admin-product-state">
          <p>
            {text("Статус", "Status")}:{" "}
            <span className={`admin-product-status ${product.status}`}>
              {text(...STATUS_LABELS[product.status])}
            </span>
          </p>
          <div className="admin-product-actions">
            {product.status !== "published" && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => changeStatus("published")}
              >
                {text("Публикувай", "Publish")}
              </button>
            )}
            {product.status !== "draft" && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => changeStatus("draft")}
              >
                {product.status === "published"
                  ? text("Свали от публикация", "Unpublish")
                  : text("Върни като чернова", "Restore as draft")}
              </button>
            )}
            {product.status !== "archived" && (
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => changeStatus("archived")}
              >
                {text("Архивирай", "Archive")}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="form-grid">
        {!product && (
          <label className="full-width">
            {text("Продуктов код (SKU)", "Product code (SKU)")}
            <input
              value={fields.sku}
              onChange={set("sku")}
              required
              maxLength={64}
              pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
              autoComplete="off"
            />
          </label>
        )}
        <label>
          {text("Име (български)", "Name (Bulgarian)")}
          <input
            value={fields.nameBg}
            onChange={set("nameBg")}
            required
            minLength={2}
            maxLength={200}
          />
        </label>
        <label>
          {text("Име (английски)", "Name (English)")}
          <input
            value={fields.nameEn}
            onChange={set("nameEn")}
            maxLength={200}
          />
        </label>
        <label>
          {text("Описание (български)", "Description (Bulgarian)")}
          <textarea
            value={fields.descriptionBg}
            onChange={set("descriptionBg")}
            maxLength={5000}
            rows={5}
          />
        </label>
        <label>
          {text("Описание (английски)", "Description (English)")}
          <textarea
            value={fields.descriptionEn}
            onChange={set("descriptionEn")}
            maxLength={5000}
            rows={5}
          />
        </label>
        <label>
          {text("Категория", "Category")}
          <select value={fields.categoryId} onChange={set("categoryId")}>
            <option value="">{text("Без категория", "No category")}</option>
            {tops.map((top) => [
              <option key={top.id} value={top.id}>
                {top.name}
                {top.active ? "" : text(" (неактивна)", " (inactive)")}
              </option>,
              ...categories
                .filter((sub) => sub.parentId === top.id)
                .map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {"— " + sub.name}
                    {sub.active ? "" : text(" (неактивна)", " (inactive)")}
                  </option>
                )),
            ])}
          </select>
        </label>
        <label>
          {text("Продажна цена с ДДС (EUR)", "Selling price incl. VAT (EUR)")}
          <input
            value={fields.price}
            onChange={set("price")}
            inputMode="decimal"
            placeholder="45,90"
          />
        </label>
        <label>
          {text("ДДС (%)", "VAT (%)")}
          <input
            value={fields.vat}
            onChange={set("vat")}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          {text("Марка", "Brand")}
          <input value={fields.brand} onChange={set("brand")} maxLength={120} />
        </label>
        <label>
          {text("Каталожен номер", "Manufacturer code")}
          <input
            value={fields.manufacturerCode}
            onChange={set("manufacturerCode")}
            maxLength={120}
          />
        </label>
        <label>
          {text("Баркод (EAN)", "Barcode (EAN)")}
          <input
            value={fields.ean}
            onChange={set("ean")}
            inputMode="numeric"
            maxLength={14}
          />
        </label>
        <label>
          {text("Тегло (грамове)", "Weight (grams)")}
          <input
            value={fields.weight}
            onChange={set("weight")}
            inputMode="numeric"
          />
        </label>
        <label className="full-width">
          {text(
            "Изображение (път под /images/)",
            "Image (path under /images/)",
          )}
          <input
            value={fields.imagePath}
            onChange={set("imagePath")}
            placeholder="/images/products/brake-pads.webp"
          />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      <button type="submit" className="button" disabled={busy}>
        {product
          ? text("Запази промените", "Save changes")
          : text("Създай чернова", "Create draft")}
      </button>
    </form>
  );
}
