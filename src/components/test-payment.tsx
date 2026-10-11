"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
export default function TestPayment({ id }: { id: string }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () =>
      setToken(new URLSearchParams(location.hash.slice(1)).get("token") ?? ""),
    [],
  );
  async function pay(outcome: "success" | "failure") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/orders/${id}/test-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-order-token": token },
        body: JSON.stringify({ outcome }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      location.assign(`/orders/${id}#token=${token}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="checkout-panel account-panel">
      <p className="eyebrow">ЛОКАЛЕН СИМУЛАТОР</p>
      <h2>Пробвай плащането.</h2>
      <p className="demo-notice">
        Това е симулация. Не въвеждай карта. Няма реално таксуване.
      </p>
      <div className="test-payment-actions">
        <button
          className="button"
          disabled={busy || token.length !== 64}
          onClick={() => pay("success")}
        >
          Симулирай успешно плащане
        </button>
        <button
          className="button"
          disabled={busy || token.length !== 64}
          onClick={() => pay("failure")}
        >
          Симулирай отказано плащане
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Link className="text-link" href={`/orders/${id}#token=${token}`}>
        Назад към поръчката
      </Link>
    </section>
  );
}
