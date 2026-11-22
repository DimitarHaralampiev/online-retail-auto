"use client";
// "My car" selector: make > model > year > (generation, when a year belongs
// to two) > engine. Native selects keep it keyboard and screen-reader
// friendly. The choice is stored by /api/vehicle-selection.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";
import { generationsInYear, modelYears } from "../lib/vehicle-years";

export type SelectedVehicle = {
  generationId: string;
  engineId: string | null;
  year: number | null;
  label: string;
};

type Option = {
  id: string;
  name: string;
  yearFrom?: number;
  yearTo?: number | null;
};

async function lookup(level: string, parent?: string): Promise<Option[]> {
  const query = new URLSearchParams({ level });
  if (parent) query.set("parent", parent);
  const response = await fetch(`/api/vehicles?${query}`);
  if (!response.ok) throw new Error("lookup failed");
  return (await response.json()).items;
}

export default function VehicleSelector({
  initial,
  signedIn,
}: {
  initial: SelectedVehicle | null;
  signedIn: boolean;
}) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const router = useRouter();
  const [current, setCurrent] = useState(initial);
  const [editing, setEditing] = useState(!initial);
  const [makes, setMakes] = useState<Option[] | null>(null);
  const [models, setModels] = useState<Option[]>([]);
  const [generations, setGenerations] = useState<Option[]>([]);
  const [engines, setEngines] = useState<Option[]>([]);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [generation, setGeneration] = useState("");
  const [engine, setEngine] = useState("");
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fail = () =>
    setError(
      text(
        "Справочникът временно не е достъпен.",
        "The vehicle reference is temporarily unavailable.",
      ),
    );

  // Makes load when the form opens (right away when nothing is selected).
  useEffect(() => {
    if (!editing || makes !== null) return;
    let live = true;
    lookup("makes")
      .then((items) => live && setMakes(items))
      .catch(() => live && fail());
    return () => {
      live = false;
    };
    // fail() only formats a message; reloading on language change is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, makes]);

  function start() {
    setEditing(true);
    setError("");
  }

  async function chooseMake(id: string) {
    setMake(id);
    setModel("");
    setYear("");
    setGeneration("");
    setEngine("");
    setModels([]);
    setGenerations([]);
    setEngines([]);
    if (!id) return;
    try {
      setModels(await lookup("models", id));
    } catch {
      fail();
    }
  }

  async function chooseModel(id: string) {
    setModel(id);
    setYear("");
    setGeneration("");
    setEngine("");
    setGenerations([]);
    setEngines([]);
    if (!id) return;
    try {
      setGenerations(await lookup("generations", id));
    } catch {
      fail();
    }
  }

  const thisYear = new Date().getFullYear();
  const matching = year
    ? generationsInYear(generations, Number(year), thisYear)
    : [];

  async function chooseGeneration(id: string) {
    setGeneration(id);
    setEngine("");
    setEngines([]);
    if (!id) return;
    try {
      setEngines(await lookup("engines", id));
    } catch {
      fail();
    }
  }

  function chooseYear(value: string) {
    setYear(value);
    const options = value
      ? generationsInYear(generations, Number(value), thisYear)
      : [];
    // One generation for that year: no need to ask.
    void chooseGeneration(options.length === 1 ? options[0].id : "");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/vehicle-selection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generationId: generation,
          engineId: engine || null,
          year: year ? Number(year) : null,
          saveToGarage: signedIn && save,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? text("Неуспешно.", "Failed."));
        return;
      }
      setCurrent(data.vehicle);
      setEditing(false);
      router.refresh();
    } catch {
      setError(text("Няма връзка.", "No connection."));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await fetch("/api/vehicle-selection", { method: "DELETE" });
      setCurrent(null);
      router.refresh();
      start();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="vehicle-selector"
      aria-labelledby="vehicle-selector-title"
    >
      <h2 id="vehicle-selector-title">{text("Моят автомобил", "My car")}</h2>
      {current && !editing && (
        <p>
          <strong>{current.label}</strong>{" "}
          <button type="button" className="text-link" onClick={start}>
            {text("Смени", "Change")}
          </button>{" "}
          <button
            type="button"
            className="text-link"
            onClick={clear}
            disabled={busy}
          >
            {text("Премахни", "Remove")}
          </button>
        </p>
      )}
      {editing && (
        <form className="vehicle-selector-form" onSubmit={submit}>
          <label>
            {text("Марка", "Make")}
            <select
              value={make}
              onChange={(e) => chooseMake(e.target.value)}
              required
              disabled={!makes?.length}
            >
              <option value="">{text("Избери марка", "Choose make")}</option>
              {makes?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {text("Модел", "Model")}
            <select
              value={model}
              onChange={(e) => chooseModel(e.target.value)}
              required
              disabled={!make}
            >
              <option value="">{text("Избери модел", "Choose model")}</option>
              {models.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {text("Година", "Year")}
            <select
              value={year}
              onChange={(e) => chooseYear(e.target.value)}
              required
              disabled={!model}
            >
              <option value="">{text("Избери година", "Choose year")}</option>
              {modelYears(generations, thisYear).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          {matching.length > 1 && (
            <label>
              {text("Поколение", "Generation")}
              <select
                value={generation}
                onChange={(e) => chooseGeneration(e.target.value)}
                required
              >
                <option value="">
                  {text("Избери поколение", "Choose generation")}
                </option>
                {matching.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.yearFrom}–{o.yearTo ?? "…"})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {text("Двигател", "Engine")}
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              disabled={!generation}
            >
              <option value="">
                {text("Не знам / всички", "Not sure / all")}
              </option>
              {engines.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          {signedIn && (
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={save}
                onChange={(e) => setSave(e.target.checked)}
              />
              {text("Запази в моя гараж", "Save to my garage")}
            </label>
          )}
          <div className="admin-product-actions">
            <button
              type="submit"
              className="button"
              disabled={busy || !generation}
            >
              {text("Избери автомобила", "Select this car")}
            </button>
            {current && (
              <button
                type="button"
                className="button"
                onClick={() => setEditing(false)}
              >
                {text("Отказ", "Cancel")}
              </button>
            )}
          </div>
        </form>
      )}
      {makes?.length === 0 && editing && !error && (
        <p>
          {text(
            "Справочникът на автомобили още се попълва.",
            "The vehicle reference is still being filled in.",
          )}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>
        <Link href="/cars" className="text-link">
          {text("Разгледай частите по марка →", "Browse parts by make →")}
        </Link>
      </p>
    </section>
  );
}
