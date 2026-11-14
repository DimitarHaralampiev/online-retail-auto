"use client";
// Upload a CSV, check it (dry run) and apply it once the check is clean.
// Apply is only offered for the exact file content that passed the check.
import { useState } from "react";
import Link from "next/link";
import { useLocale } from "./locale-provider";

type RowResult = {
  line: number;
  sku: string;
  action: "create" | "update" | "unchanged" | "error";
  errors: string[];
};
type Report = {
  applied: boolean;
  error?: string;
  rows: RowResult[];
  summary: Record<RowResult["action"], number>;
};

const MAX_BYTES = 2 * 1024 * 1024;

export default function ProductImport() {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const labels: Record<RowResult["action"], string> = {
    create: text("Нов", "New"),
    update: text("Промяна", "Update"),
    unchanged: text("Без промяна", "Unchanged"),
    error: text("Грешка", "Error"),
  };

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    setReport(null);
    setChecked(false);
    setError("");
    setFile(null);
    if (!chosen) return;
    if (chosen.size > MAX_BYTES)
      return setError(
        text("Файлът е по-голям от 2 MB.", "The file is larger than 2 MB."),
      );
    setFile({ name: chosen.name, csv: await chosen.text() });
  }

  async function run(apply: boolean) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/catalog/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: file.csv, apply, filename: file.name }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? text("Неуспешна заявка.", "Request failed."));
        return;
      }
      setReport(data as Report);
      setChecked(!apply && !data.error && data.summary.error === 0);
    } catch {
      setError(
        text("Няма връзка. Опитай отново.", "No connection. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  const shown = report?.rows.filter((row) => row.action !== "unchanged") ?? [];
  return (
    <section className="checkout-panel admin-product-form">
      <label>
        {text("CSV файл", "CSV file")}
        <input type="file" accept=".csv,text/csv" onChange={choose} />
      </label>
      <div className="admin-product-actions">
        <button
          type="button"
          className="button"
          disabled={!file || busy}
          onClick={() => run(false)}
        >
          {text("Провери", "Check")}
        </button>
        <button
          type="button"
          className="button"
          disabled={!checked || busy}
          onClick={() => run(true)}
        >
          {text("Импортирай", "Import")}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div role="status">
        {report?.error && <p className="error">{report.error}</p>}
        {report && !report.error && (
          <p>
            {report.applied
              ? text("Импортът е приложен. ", "Import applied. ")
              : report.summary.error
                ? text(
                    "Има грешки — нищо не е променено. ",
                    "There are errors — nothing was changed. ",
                  )
                : text(
                    "Проверката е успешна — можеш да импортираш. ",
                    "Check passed — you can import. ",
                  )}
            {(Object.keys(labels) as RowResult["action"][])
              .map((action) => `${labels[action]}: ${report.summary[action]}`)
              .join(" · ")}
          </p>
        )}
        {report?.applied && (
          <p>
            <Link href="/admin/products">
              {text("Към продуктите →", "Go to products →")}
            </Link>
          </p>
        )}
      </div>
      {shown.length > 0 && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th scope="col">{text("Ред", "Line")}</th>
                <th scope="col">SKU</th>
                <th scope="col">{text("Действие", "Action")}</th>
                <th scope="col">{text("Грешки", "Errors")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.line}>
                  <td>{row.line}</td>
                  <td>{row.sku || "—"}</td>
                  <td>{labels[row.action]}</td>
                  <td>{row.errors.join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
