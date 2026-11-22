"use client";
// Verified vehicle fitments of one product: list, remove, and add through a
// make > model > generation > engine selector backed by /api/vehicles.
import { useEffect, useState } from "react";
import { useLocale } from "./locale-provider";
import { parseWholeNumber } from "../lib/admin-product-shared";

export type FitmentRow = {
  id: string;
  make: string;
  model: string;
  generation: string;
  generationYears: [number, number | null];
  engine: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  notes: string;
  source: string;
  hidden: boolean;
};

type Option = {
  id: string;
  name: string;
  yearFrom?: number;
  yearTo?: number | null;
};
type Level = "makes" | "models" | "generations" | "engines";

async function lookup(level: Level, parent?: string): Promise<Option[]> {
  const query = new URLSearchParams({ level });
  if (parent) query.set("parent", parent);
  const response = await fetch(`/api/vehicles?${query}`);
  if (!response.ok) throw new Error("lookup failed");
  return (await response.json()).items;
}

const years = (from: number | null, to: number | null) =>
  from === null && to === null ? "" : `${from ?? "…"}–${to ?? "…"}`;

export default function ProductFitments({
  sku,
  initial,
}: {
  sku: string;
  initial: FitmentRow[];
}) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const [fitments, setFitments] = useState(initial);
  const [options, setOptions] = useState<Record<Level, Option[]>>({
    makes: [],
    models: [],
    generations: [],
    engines: [],
  });
  const [chosen, setChosen] = useState({
    make: "",
    model: "",
    generation: "",
    engine: "",
  });
  const [form, setForm] = useState({
    yearFrom: "",
    yearTo: "",
    notes: "",
    source: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    lookup("makes")
      .then((makes) => setOptions((o) => ({ ...o, makes })))
      .catch(() =>
        setError(
          text(
            "Справочникът не може да се зареди.",
            "The vehicle reference could not be loaded.",
          ),
        ),
      );
    // Loaded once; the language toggle only changes labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(level: "make" | "model" | "generation", id: string) {
    const next = { ...chosen, [level]: id };
    const below: Record<typeof level, Level[]> = {
      make: ["models", "generations", "engines"],
      model: ["generations", "engines"],
      generation: ["engines"],
    };
    if (level === "make") Object.assign(next, { model: "", generation: "" });
    if (level === "model") next.generation = "";
    next.engine = "";
    setChosen(next);
    const cleared = Object.fromEntries(below[level].map((l) => [l, []]));
    setOptions((o) => ({ ...o, ...cleared }));
    if (!id) return;
    const child = below[level][0];
    try {
      const items = await lookup(child, id);
      setOptions((o) => ({ ...o, [child]: items }));
    } catch {
      setError(text("Неуспешно зареждане.", "Loading failed."));
    }
  }

  async function send(url: string, init: RequestInit) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, init);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? text("Неуспешно.", "Failed."));
        return false;
      }
      setFitments(data.fitments);
      return true;
    } catch {
      setError(text("Няма връзка.", "No connection."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const from = parseWholeNumber(form.yearFrom);
    const to = parseWholeNumber(form.yearTo);
    if (Number.isNaN(from) || Number.isNaN(to))
      return setError(
        text("Годините са цели числа.", "Years are whole numbers."),
      );
    const ok = await send(
      `/api/admin/catalog/products/${encodeURIComponent(sku)}/fitments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generationId: chosen.generation,
          engineId: chosen.engine || null,
          yearFrom: from,
          yearTo: to,
          notes: form.notes,
          source: form.source,
        }),
      },
    );
    if (ok) {
      setNotice(text("Съвместимостта е запазена.", "Fitment saved."));
      setForm((f) => ({ ...f, yearFrom: "", yearTo: "", notes: "" }));
    }
  }

  async function remove(row: FitmentRow) {
    const ok = await send(
      `/api/admin/catalog/products/${encodeURIComponent(sku)}/fitments/${row.id}`,
      { method: "DELETE" },
    );
    if (ok) setNotice(text("Премахнато.", "Removed."));
  }

  const generation = options.generations.find(
    (g) => g.id === chosen.generation,
  );
  return (
    <section className="checkout-panel" aria-labelledby="fitments-heading">
      <h2 id="fitments-heading">
        {text("Съвместимост с автомобили", "Vehicle fitment")}
      </h2>
      <p>
        {text(
          "Въвеждай само съвместимост, проверена в каталог на производителя или лицензиран каталог, и посочвай източника.",
          "Enter only fitment verified in a manufacturer or licensed catalogue, and name the source.",
        )}
      </p>
      {fitments.length === 0 ? (
        <p>{text("Няма въведена съвместимост.", "No fitment entered.")}</p>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th scope="col">{text("Автомобил", "Vehicle")}</th>
                <th scope="col">{text("Двигател", "Engine")}</th>
                <th scope="col">{text("Години", "Years")}</th>
                <th scope="col">{text("Източник", "Source")}</th>
                <th scope="col">
                  <span className="visually-hidden">
                    {text("Действия", "Actions")}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {fitments.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.make} {row.model} {row.generation} (
                    {years(...row.generationYears)})
                    {row.hidden && ` — ${text("скрит", "hidden")}`}
                    {row.notes && (
                      <>
                        <br />
                        <small>{row.notes}</small>
                      </>
                    )}
                  </td>
                  <td>{row.engine ?? text("Всички", "All")}</td>
                  <td>{years(row.yearFrom, row.yearTo) || "—"}</td>
                  <td>{row.source}</td>
                  <td>
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => remove(row)}
                      aria-label={
                        text("Премахни ", "Remove ") +
                        `${row.make} ${row.model} ${row.generation}`
                      }
                    >
                      {text("Премахни", "Remove")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="form-grid" onSubmit={add}>
        <label>
          {text("Марка", "Make")}
          <select
            value={chosen.make}
            onChange={(e) => choose("make", e.target.value)}
            required
          >
            <option value="">{text("Избери", "Choose")}</option>
            {options.makes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("Модел", "Model")}
          <select
            value={chosen.model}
            onChange={(e) => choose("model", e.target.value)}
            disabled={!chosen.make}
            required
          >
            <option value="">{text("Избери", "Choose")}</option>
            {options.models.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("Поколение", "Generation")}
          <select
            value={chosen.generation}
            onChange={(e) => choose("generation", e.target.value)}
            disabled={!chosen.model}
            required
          >
            <option value="">{text("Избери", "Choose")}</option>
            {options.generations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({years(o.yearFrom ?? null, o.yearTo ?? null)})
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("Двигател", "Engine")}
          <select
            value={chosen.engine}
            onChange={(e) => setChosen({ ...chosen, engine: e.target.value })}
            disabled={!chosen.generation}
          >
            <option value="">{text("Всички двигатели", "All engines")}</option>
            {options.engines.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("От година (по избор)", "From year (optional)")}
          <input
            value={form.yearFrom}
            onChange={(e) => setForm({ ...form, yearFrom: e.target.value })}
            inputMode="numeric"
            placeholder={
              generation?.yearFrom ? String(generation.yearFrom) : ""
            }
          />
        </label>
        <label>
          {text("До година (по избор)", "To year (optional)")}
          <input
            value={form.yearTo}
            onChange={(e) => setForm({ ...form, yearTo: e.target.value })}
            inputMode="numeric"
            placeholder={generation?.yearTo ? String(generation.yearTo) : ""}
          />
        </label>
        <label className="full-width">
          {text(
            "Източник на проверката (каталог, страница, номер)",
            "Verification source (catalogue, page, number)",
          )}
          <input
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            required
            minLength={2}
            maxLength={200}
          />
        </label>
        <label className="full-width">
          {text("Бележка (напр. предна ос)", "Note (e.g. front axle)")}
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            maxLength={500}
          />
        </label>
        {error && (
          <p className="error full-width" role="alert">
            {error}
          </p>
        )}
        <p className="full-width" role="status">
          {notice}
        </p>
        <button type="submit" className="button" disabled={busy}>
          {text("Добави съвместимост", "Add fitment")}
        </button>
      </form>
    </section>
  );
}
