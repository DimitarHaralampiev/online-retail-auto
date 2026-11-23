"use client";
// Adds or edits one entry of the vehicle reference in a dialog (#91). The
// server validates everything; this only collects the fields.
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";
import { parseWholeNumber } from "../lib/admin-product-shared";
import { FUEL_LABELS } from "../lib/vehicle-fuels";

type Kind = "make" | "model" | "generation" | "engine";

export type VehicleEntry = {
  id: string;
  version: number;
  name: string;
  yearFrom?: number;
  yearTo?: number | null;
  fuel?: string;
  displacementCc?: number | null;
  powerKw?: number | null;
  engineCode?: string;
};

const TITLES: Record<Kind, [string, string]> = {
  make: ["Марка", "Make"],
  model: ["Модел", "Model"],
  generation: ["Поколение", "Generation"],
  engine: ["Двигател", "Engine"],
};

const fieldsOf = (entry?: VehicleEntry) => ({
  name: entry?.name ?? "",
  slug: "",
  yearFrom: entry?.yearFrom ? String(entry.yearFrom) : "",
  yearTo: entry?.yearTo ? String(entry.yearTo) : "",
  fuel: entry?.fuel ?? "",
  displacementCc: entry?.displacementCc ? String(entry.displacementCc) : "",
  powerKw: entry?.powerKw ? String(entry.powerKw) : "",
  engineCode: entry?.engineCode ?? "",
});
type Fields = ReturnType<typeof fieldsOf>;

export default function VehicleForm({
  kind,
  label,
  about,
  entry,
  parentId,
  className = "text-link",
}: {
  kind: Kind;
  /** The visible text of the button that opens the form. */
  label: string;
  /** What the button is about, for its accessible name. */
  about?: string;
  /** The entry to edit; without it, a new one is added under `parentId`. */
  entry?: VehicleEntry;
  parentId?: string;
  className?: string;
}) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(entry));
  // The form exists only while open: a page lists hundreds of entries.
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = about ? `${label}: ${about}` : label;
  const set =
    (key: keyof Fields) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setFields((now) => ({ ...now, [key]: event.target.value }));

  function open() {
    // Rendered before showModal(), so the first field gets the focus.
    flushSync(() => {
      setFields(fieldsOf(entry));
      setError("");
      setOpened(true);
    });
    dialog.current?.showModal();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const numbers = {
      yearFrom: parseWholeNumber(fields.yearFrom),
      yearTo: parseWholeNumber(fields.yearTo),
      displacementCc: parseWholeNumber(fields.displacementCc),
      powerKw: parseWholeNumber(fields.powerKw),
    };
    if (Object.values(numbers).some((value) => Number.isNaN(value)))
      return setError(
        text(
          "Годините, обемът и мощността са цели числа.",
          "Years, displacement and power are whole numbers.",
        ),
      );
    const values = {
      make: { name: fields.name },
      model: { name: fields.name },
      generation: {
        name: fields.name,
        yearFrom: numbers.yearFrom,
        yearTo: numbers.yearTo,
      },
      engine: {
        name: fields.name,
        fuel: fields.fuel,
        displacementCc: numbers.displacementCc,
        powerKw: numbers.powerKw,
        engineCode: fields.engineCode,
      },
    }[kind];
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        entry
          ? `/api/admin/vehicles/${kind}/${entry.id}`
          : `/api/admin/vehicles/${kind}`,
        {
          method: entry ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            entry
              ? { version: entry.version, fields: values }
              : {
                  ...values,
                  ...(parentId && { parentId }),
                  ...((kind === "make" || kind === "model") && {
                    slug: fields.slug,
                  }),
                },
          ),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? text("Неуспешно запазване.", "Saving failed."));
        return;
      }
      dialog.current?.close();
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
      <button
        type="button"
        className={className}
        onClick={open}
        aria-label={about ? title : undefined}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        className="vehicle-form-dialog"
        aria-label={title}
        onClose={() => setOpened(false)}
      >
        {opened && (
          <form className="admin-product-form" onSubmit={save}>
            <h2>{title}</h2>
            <div className="form-grid">
              <label className="full-width">
                {text(...TITLES[kind])} ({text("име", "name")})
                <input
                  value={fields.name}
                  onChange={set("name")}
                  required
                  maxLength={100}
                  autoComplete="off"
                />
              </label>
              {!entry && (kind === "make" || kind === "model") && (
                <label className="full-width">
                  {text(
                    "Адрес (по избор; нужен само за име без латински букви; не се променя по-късно)",
                    "Address (optional; only needed for a name without Latin letters; cannot change later)",
                  )}
                  <input
                    value={fields.slug}
                    onChange={set("slug")}
                    maxLength={60}
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                    autoComplete="off"
                  />
                </label>
              )}
              {kind === "generation" && (
                <>
                  <label>
                    {text("От година", "From year")}
                    <input
                      inputMode="numeric"
                      value={fields.yearFrom}
                      onChange={set("yearFrom")}
                      required
                      maxLength={4}
                    />
                  </label>
                  <label>
                    {text(
                      "До година (празно: още се произвежда)",
                      "To year (empty: still in production)",
                    )}
                    <input
                      inputMode="numeric"
                      value={fields.yearTo}
                      onChange={set("yearTo")}
                      maxLength={4}
                    />
                  </label>
                </>
              )}
              {kind === "engine" && (
                <>
                  <label>
                    {text("Гориво", "Fuel")}
                    <select value={fields.fuel} onChange={set("fuel")} required>
                      <option value="">{text("Избери…", "Choose…")}</option>
                      {Object.entries(FUEL_LABELS).map(([fuel, names]) => (
                        <option key={fuel} value={fuel}>
                          {text(...names)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {text("Обем (куб. см)", "Displacement (cc)")}
                    <input
                      inputMode="numeric"
                      value={fields.displacementCc}
                      onChange={set("displacementCc")}
                      maxLength={5}
                    />
                  </label>
                  <label>
                    {text("Мощност (kW)", "Power (kW)")}
                    <input
                      inputMode="numeric"
                      value={fields.powerKw}
                      onChange={set("powerKw")}
                      maxLength={4}
                    />
                  </label>
                  <label>
                    {text("Код на двигателя", "Engine code")}
                    <input
                      value={fields.engineCode}
                      onChange={set("engineCode")}
                      maxLength={60}
                      autoComplete="off"
                    />
                  </label>
                </>
              )}
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
                onClick={() => dialog.current?.close()}
              >
                {text("Отказ", "Cancel")}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
