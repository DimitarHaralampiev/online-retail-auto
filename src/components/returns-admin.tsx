"use client";
// Admin processing of return requests (#48): approve, reject, receive.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "./locale-provider";
import { formatMoney } from "../lib/cart";

export type AdminReturnRow = {
  id: string;
  orderId: string;
  status: "requested" | "approved" | "rejected" | "received";
  reason: string;
  adminNote: string;
  createdAt: string;
  totalCents: number;
  refundCents: number | null;
  customerEmail?: string;
  lines: { lineNumber: number; sku: string; name: string; quantity: number }[];
};

const LABELS: Record<AdminReturnRow["status"], [string, string]> = {
  requested: ["Чака решение", "Awaiting decision"],
  approved: ["Одобрено — чакаме стоката", "Approved — awaiting goods"],
  rejected: ["Отказано", "Rejected"],
  received: ["Получено", "Received"],
};

export default function ReturnsAdmin({ rows }: { rows: AdminReturnRow[] }) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function act(id: string, action: "approve" | "reject" | "receive") {
    setBusy(id);
    setError("");
    try {
      const response = await fetch(`/api/admin/returns/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note: notes[id] ?? "" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setError(data.error ?? text("Неуспешно.", "Failed."));
      else router.refresh();
    } catch {
      setError(text("Няма връзка.", "No connection."));
    } finally {
      setBusy("");
    }
  }

  if (!rows.length)
    return <p>{text("Няма заявки за връщане.", "No return requests.")}</p>;
  return (
    <div className="admin-order-list">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {rows.map((row) => (
        <article key={row.id} className="checkout-panel">
          <h2>
            #{row.orderId.slice(0, 8).toUpperCase()} ·{" "}
            {text(...LABELS[row.status])}
          </h2>
          <p>
            {row.customerEmail} ·{" "}
            {new Date(row.createdAt).toLocaleString(
              locale === "en" ? "en-GB" : "bg-BG",
              {
                timeZone: "Europe/Sofia",
              },
            )}{" "}
            · {formatMoney(row.totalCents)}
          </p>
          <ul>
            {row.lines.map((line) => (
              <li key={line.lineNumber}>
                {line.quantity} × {line.name} ({line.sku})
              </li>
            ))}
          </ul>
          {row.reason && (
            <p>
              {text("Причина: ", "Reason: ")}
              {row.reason}
            </p>
          )}
          {row.adminNote && <p className="note">{row.adminNote}</p>}
          {row.refundCents !== null && (
            <p>
              <strong>
                {text("За възстановяване (стоки): ", "To refund (goods): ")}
                {formatMoney(row.refundCents)}
              </strong>
            </p>
          )}
          <Link href={`/orders/${row.orderId}`}>
            {text("Поръчката →", "The order →")}
          </Link>
          {(row.status === "requested" || row.status === "approved") && (
            <div className="form-grid">
              <label className="full-width">
                {text(
                  "Бележка към клиента (по избор)",
                  "Note to the customer (optional)",
                )}
                <input
                  value={notes[row.id] ?? ""}
                  onChange={(e) =>
                    setNotes({ ...notes, [row.id]: e.target.value })
                  }
                  maxLength={1000}
                />
              </label>
              <div className="admin-product-actions">
                {row.status === "requested" ? (
                  <>
                    <button
                      type="button"
                      className="button"
                      disabled={!!busy}
                      onClick={() => act(row.id, "approve")}
                    >
                      {text("Одобри", "Approve")}
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={!!busy}
                      onClick={() => act(row.id, "reject")}
                    >
                      {text("Откажи", "Reject")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="button"
                    disabled={!!busy}
                    onClick={() => act(row.id, "receive")}
                  >
                    {text(
                      "Стоката е получена — върни в склада",
                      "Goods received — back into stock",
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
