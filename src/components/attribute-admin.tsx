"use client";
// Attribute definitions with an editor for one at a time (#103). The server
// validates every change; this component only collects the fields.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";
import { parseWholeNumber } from "../lib/admin-product-shared";

export type AttributeRow = {
  key: string;
  name: { bg: string; en: string };
  unit: string;
  sortOrder: number;
  filterable: boolean;
  version: number;
  products: number;
};

type Fields = {
  key: string;
  nameBg: string;
  nameEn: string;
  unit: string;
  sortOrder: string;
  filterable: boolean;
};

const fieldsOf = (a: AttributeRow | null): Fields => ({
  key: a?.key ?? "",
  nameBg: a?.name.bg ?? "",
  nameEn: a?.name.en ?? "",
  unit: a?.unit ?? "",
  sortOrder: String(a?.sortOrder ?? 0),
  filterable: a?.filterable ?? true,
});

export default function AttributeAdmin({
  attributes,
}: {
  attributes: AttributeRow[];
}) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const router = useRouter();
  // null: closed; "": create form (keys are never empty); else the edited key.
  const [editing, setEditing] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>(fieldsOf(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const current = attributes.find((a) => a.key === editing) ?? null;
  const set =
    (key: "key" | "nameBg" | "nameEn" | "unit" | "sortOrder") =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setFields((now) => ({ ...now, [key]: event.target.value }));

  function open(attribute: AttributeRow | null) {
    setEditing(attribute?.key ?? "");
    setFields(fieldsOf(attribute));
    setError("");
    setNotice("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const sortOrder = parseWholeNumber(fields.sortOrder);
    if (sortOrder === null || Number.isNaN(sortOrder))
      return setError(
        text(
          "Подредбата трябва да е цяло число.",
          "The order must be a whole number.",
        ),
      );
    const body = {
      name: { bg: fields.nameBg, en: fields.nameEn },
      unit: fields.unit,
      sortOrder,
      filterable: fields.filterable,
    };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        current
          ? `/api/admin/catalog/attributes/${current.key}`
          : "/api/admin/catalog/attributes",
        {
          method: current ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            current
              ? { ...body, version: current.version }
              : { ...body, key: fields.key },
          ),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? text("Неуспешно запазване.", "Saving failed."));
        return;
      }
      setEditing(null);
      setNotice(text("Характеристиката е запазена.", "Attribute saved."));
      router.refresh();
    } catch {
      setError(
        text("Няма връзка. Опитай отново.", "No connection. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-product-toolbar">
        <p role="status">{notice}</p>
        <button type="button" className="button" onClick={() => open(null)}>
          {text("Нова характеристика", "New attribute")}
        </button>
      </div>
      {editing !== null && (
        <form className="checkout-panel admin-product-form" onSubmit={save}>
          <h2>
            {current
              ? text("Редакция: ", "Edit: ") + current.name.bg
              : text("Нова характеристика", "New attribute")}
          </h2>
          <div className="form-grid">
            {current ? (
              <p className="full-width">
                {text("Ключ", "Key")}: <code>{current.key}</code>
              </p>
            ) : (
              <label className="full-width">
                {text(
                  "Ключ (малки латински букви, цифри и тирета; не се променя по-късно)",
                  "Key (lowercase letters, digits and dashes; cannot change later)",
                )}
                <input
                  value={fields.key}
                  onChange={set("key")}
                  required
                  maxLength={40}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
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
                maxLength={60}
              />
            </label>
            <label>
              {text("Име (английски)", "Name (English)")}
              <input
                value={fields.nameEn}
                onChange={set("nameEn")}
                maxLength={60}
              />
            </label>
            <label>
              {text("Мерна единица (по избор)", "Unit (optional)")}
              <input
                value={fields.unit}
                onChange={set("unit")}
                maxLength={20}
              />
            </label>
            <label>
              {text("Подредба", "Order")}
              <input
                inputMode="numeric"
                value={fields.sortOrder}
                onChange={set("sortOrder")}
                required
              />
            </label>
            <label className="full-width admin-checkbox">
              <input
                type="checkbox"
                checked={fields.filterable}
                onChange={(e) =>
                  setFields({ ...fields, filterable: e.target.checked })
                }
              />
              {text("Филтър в каталога", "Filter in the catalog")}
            </label>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="admin-product-actions">
            <button type="submit" className="button" disabled={busy}>
              {text("Запази", "Save")}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setEditing(null)}
            >
              {text("Отказ", "Cancel")}
            </button>
          </div>
        </form>
      )}
      {attributes.length === 0 ? (
        <p>{text("Още няма характеристики.", "No attributes yet.")}</p>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th scope="col">{text("Характеристика", "Attribute")}</th>
                <th scope="col">{text("Ключ", "Key")}</th>
                <th scope="col">{text("Английско име", "English name")}</th>
                <th scope="col">{text("Мерна единица", "Unit")}</th>
                <th scope="col">{text("Подредба", "Order")}</th>
                <th scope="col">{text("Филтър", "Filter")}</th>
                <th scope="col">{text("Продукти", "Products")}</th>
                <th scope="col">
                  <span className="visually-hidden">
                    {text("Действия", "Actions")}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {attributes.map((attribute) => (
                <tr key={attribute.key}>
                  <td>{attribute.name.bg}</td>
                  <td>
                    <code>{attribute.key}</code>
                  </td>
                  <td>{attribute.name.en || "—"}</td>
                  <td>{attribute.unit || "—"}</td>
                  <td>{attribute.sortOrder}</td>
                  <td>
                    {attribute.filterable
                      ? text("Да", "Yes")
                      : text("Не", "No")}
                  </td>
                  <td>{attribute.products}</td>
                  <td>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => open(attribute)}
                      aria-label={
                        text("Редактирай ", "Edit ") + attribute.name.bg
                      }
                    >
                      {text("Редактирай", "Edit")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
