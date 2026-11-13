"use client";
import Localize from "./localize";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
// The token lives in the URL fragment, which browsers never send to the server.
const readHashToken = () =>
  new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
const noServerToken = () => "";
export default function TestPayment({ id }: { id: string }) {
  const router = useRouter();
  const token = useSyncExternalStore(
    subscribeToHash,
    readHashToken,
    noServerToken,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      router.push(`/orders/${id}#token=${token}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Localize>
      {
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
      }
    </Localize>
  );
}
