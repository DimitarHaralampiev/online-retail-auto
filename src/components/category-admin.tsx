"use client";
// Category list with an editor for one category at a time. The server
// validates every change; this component only collects the fields.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";
import { parseWholeNumber } from "../lib/admin-product-shared";

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  nameEn: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  version: number;
  products: { published: number; other: number; publishedInTree: number };
  subcategories: number;
};

type Fields = {
  slug: string;
  nameBg: string;
  nameEn: string;
  parentId: string;
  sortOrder: string;
  active: boolean;
};

const fieldsOf = (c: CategoryRow | null): Fields => ({
  slug: c?.slug ?? "",
  nameBg: c?.name ?? "",
  nameEn: c?.nameEn ?? "",
  parentId: c?.parentId ?? "",
  sortOrder: String(c?.sortOrder ?? 0),
  active: c?.active ?? true,
});

export default function CategoryAdmin({
  categories,
}: {
  categories: CategoryRow[];
}) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const router = useRouter();
  // null: closed; "new": create form; otherwise the edited category's id.
  const [editing, setEditing] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>(fieldsOf(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const current = categories.find((c) => c.id === editing) ?? null;
  const parents = categories.filter((c) => !c.parentId && c.id !== current?.id);

  function open(category: CategoryRow | null) {
    setEditing(category ? category.id : "new");
    const next = fieldsOf(category);
    // Legacy rows nested too deep: offer moving them to a valid place.
    if (
      next.parentId &&
      !categories.some((c) => c.id === next.parentId && !c.parentId)
    )
      next.parentId = "";
    setFields(next);
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
    const hidden =
      current &&
      current.active &&
      !fields.active &&
      current.products.publishedInTree > 0;
    if (
      hidden &&
      !window.confirm(
        text(
          `Публикувани продукти, които ще се скрият от магазина: ${current.products.publishedInTree}${current.subcategories ? " (заедно с подкатегориите)" : ""}. Продължи?`,
          `Published products that will be hidden from the shop: ${current.products.publishedInTree}${current.subcategories ? " (including subcategories)" : ""}. Continue?`,
        ),
      )
    )
      return;
    const body = {
      name: { bg: fields.nameBg, en: fields.nameEn },
      parentId: fields.parentId || null,
      sortOrder,
      active: fields.active,
    };
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        current
          ? `/api/admin/catalog/categories/${current.id}`
          : "/api/admin/catalog/categories",
        {
          method: current ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            current
              ? { ...body, version: current.version }
              : { ...body, slug: fields.slug },
          ),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? text("Неуспешно запазване.", "Saving failed."));
        return;
      }
      setEditing(null);
      setNotice(text("Категорията е запазена.", "Category saved."));
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
          {text("Нова категория", "New category")}
        </button>
      </div>
      {editing && (
        <form className="checkout-panel admin-product-form" onSubmit={save}>
          <h2>
            {current
              ? text("Редакция: ", "Edit: ") + current.name
              : text("Нова категория", "New category")}
          </h2>
          <div className="form-grid">
            {current ? (
              <p className="full-width">
                {text("Адрес", "Address")}: <code>{current.slug}</code>
              </p>
            ) : (
              <label className="full-width">
                {text(
                  "Адрес (малки латински букви, цифри и тирета; не се променя по-късно)",
                  "Address (lowercase letters, digits and dashes; cannot change later)",
                )}
                <input
                  value={fields.slug}
                  onChange={(e) =>
                    setFields({ ...fields, slug: e.target.value })
                  }
                  required
                  minLength={2}
                  maxLength={60}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  autoComplete="off"
                />
              </label>
            )}
            <label>
              {text("Име (български)", "Name (Bulgarian)")}
              <input
                value={fields.nameBg}
                onChange={(e) =>
                  setFields({ ...fields, nameBg: e.target.value })
                }
                required
                minLength={2}
                maxLength={100}
              />
            </label>
            <label>
              {text("Име (английски)", "Name (English)")}
              <input
                value={fields.nameEn}
                onChange={(e) =>
                  setFields({ ...fields, nameEn: e.target.value })
                }
                maxLength={100}
              />
            </label>
            <label>
              {text("Родителска категория", "Parent category")}
              <select
                value={fields.parentId}
                onChange={(e) =>
                  setFields({ ...fields, parentId: e.target.value })
                }
                disabled={(current?.subcategories ?? 0) > 0}
              >
                <option value="">
                  {text("Няма (основна категория)", "None (top-level)")}
                </option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {text("Подредба (по-малкото е по-напред)", "Order (lower first)")}
              <input
                value={fields.sortOrder}
                onChange={(e) =>
                  setFields({ ...fields, sortOrder: e.target.value })
                }
                inputMode="numeric"
                required
              />
            </label>
            <label className="full-width admin-checkbox">
              <input
                type="checkbox"
                checked={fields.active}
                onChange={(e) =>
                  setFields({ ...fields, active: e.target.checked })
                }
              />
              {text(
                "Активна (видима в магазина)",
                "Active (shown in the shop)",
              )}
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
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th scope="col">{text("Категория", "Category")}</th>
              <th scope="col">{text("Адрес", "Address")}</th>
              <th scope="col">{text("Английско име", "English name")}</th>
              <th scope="col">{text("Подредба", "Order")}</th>
              <th scope="col">{text("Статус", "Status")}</th>
              <th scope="col">{text("Продукти", "Products")}</th>
              <th scope="col">
                <span className="visually-hidden">
                  {text("Действия", "Actions")}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <td>
                  {category.parentId ? "— " : ""}
                  {category.name}
                </td>
                <td>
                  <code>{category.slug}</code>
                </td>
                <td>{category.nameEn || "—"}</td>
                <td>{category.sortOrder}</td>
                <td>
                  <span
                    className={`admin-product-status ${category.active ? "published" : "archived"}`}
                  >
                    {category.active
                      ? text("Активна", "Active")
                      : text("Неактивна", "Inactive")}
                  </span>
                </td>
                <td>
                  {category.products.published}
                  {category.products.other
                    ? ` + ${category.products.other} ${text("непубликувани", "unpublished")}`
                    : ""}
                </td>
                <td>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => open(category)}
                    aria-label={text("Редактирай ", "Edit ") + category.name}
                  >
                    {text("Редактирай", "Edit")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
