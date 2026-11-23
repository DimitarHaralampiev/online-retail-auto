"use client";
// Return requests for a delivered order (#48), within the 14-day period.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "./locale-provider";
import { formatMoney } from "../lib/cart";
import type { OrderView } from "./order-tracking";

type ReturnView = {
  id: string;
  status: "requested" | "approved" | "rejected" | "received";
  reason: string;
  adminNote: string;
  createdAt: string;
  totalCents: number;
  lines: { lineNumber: number; name: string; quantity: number }[];
};

const LABELS: Record<ReturnView["status"], [string, string]> = {
  requested: ["Заявено", "Requested"],
  approved: ["Одобрено — изпрати артикулите", "Approved — send the items back"],
  rejected: ["Отказано", "Rejected"],
  received: ["Получено", "Received"],
};

export default function OrderReturns({ order }: { order: OrderView }) {
  const { locale } = useLocale();
  const text = (bg: string, en: string) => (locale === "en" ? en : bg);
  const [returns, setReturns] = useState<ReturnView[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const deadline = order.returnDeadline ? new Date(order.returnDeadline) : null;
  // The time the page opened; the server checks the deadline again anyway.
  const [openedAt] = useState(() => Date.now());
  const open = !!deadline && openedAt <= deadline.getTime();

  useEffect(() => {
    let live = true;
    fetch(`/api/orders/${order.id}/returns`)
      .then(async (response) => {
        if (!live) return;
        if (response.status === 401) return setSignedOut(true);
        if (response.ok) setReturns((await response.json()).returns);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [order.id]);

  const pending = returns?.some(
    (r) => r.status === "requested" || r.status === "approved",
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const lines = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([line, quantity]) => ({ lineNumber: Number(line), quantity }));
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/orders/${order.id}/returns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lines, reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? text("Неуспешно.", "Failed."));
        return;
      }
      setReturns(data.returns);
      setQuantities({});
      setReason("");
      setNotice(
        text(
          "Заявката е изпратена. Ще получиш имейл, когато я разгледаме.",
          "Request sent. You will get an email once we have reviewed it.",
        ),
      );
    } catch {
      setError(text("Няма връзка.", "No connection."));
    } finally {
      setBusy(false);
    }
  }

  if (!deadline) return null;
  return (
    <section className="order-returns" aria-labelledby="returns-heading">
      <h3 id="returns-heading">{text("Връщане", "Returns")}</h3>
      <p>
        {open
          ? text(
              `Можеш да заявиш връщане до ${deadline.toLocaleDateString("bg-BG", { timeZone: "Europe/Sofia" })}.`,
              `You can request a return until ${deadline.toLocaleDateString("en-GB", { timeZone: "Europe/Sofia" })}.`,
            )
          : text(
              "Срокът за заявка за връщане е изтекъл.",
              "The period for requesting a return has ended.",
            )}{" "}
        <Link href="/legal/returns">
          {text("Условия за връщане", "Returns policy")}
        </Link>
      </p>
      {returns?.map((request) => (
        <article key={request.id} className="return-request">
          <p>
            <strong>{text(...LABELS[request.status])}</strong> ·{" "}
            {new Date(request.createdAt).toLocaleDateString(
              locale === "en" ? "en-GB" : "bg-BG",
            )}{" "}
            · {formatMoney(request.totalCents)}
          </p>
          <ul>
            {request.lines.map((line) => (
              <li key={line.lineNumber}>
                {line.quantity} × {line.name}
              </li>
            ))}
          </ul>
          {request.adminNote && <p className="note">{request.adminNote}</p>}
        </article>
      ))}
      {signedOut && open && (
        <p>
          <Link href="/account">
            {text(
              "Влез в профила си, за да заявиш връщане.",
              "Sign in to request a return.",
            )}
          </Link>
        </p>
      )}
      {returns && open && !pending && (
        <form className="form-grid" onSubmit={submit}>
          {order.lines.map((line, index) => (
            <label key={index}>
              {line.name}
              <select
                value={quantities[index + 1] ?? 0}
                onChange={(e) =>
                  setQuantities({
                    ...quantities,
                    [index + 1]: Number(e.target.value),
                  })
                }
              >
                {Array.from({ length: line.quantity + 1 }, (_, q) => (
                  <option key={q} value={q}>
                    {q === 0
                      ? text("Не връщам", "Keep")
                      : `${q} ${text("бр.", "pcs")}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="full-width">
            {text("Причина (по избор)", "Reason (optional)")}
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              rows={3}
            />
          </label>
          {error && (
            <p className="error full-width" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="button"
            disabled={busy || !Object.values(quantities).some((q) => q > 0)}
          >
            {text("Заяви връщане", "Request a return")}
          </button>
        </form>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
