"use client";
import Localize from "./localize";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
export default function EmailVerification() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    setToken(new URLSearchParams(location.hash.slice(1)).get("token") ?? "");
    history.replaceState(history.state, "", location.pathname);
  }, []);
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", token }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setMessage(data.message);
      setToken("");
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
          <h2>Потвърди своя имейл.</h2>
          <p>
            Натисни бутона, за да активираш профила си. Линкът е валиден 1 час.
          </p>
          {token && (
            <button className="button" disabled={busy} onClick={confirm}>
              {busy ? "Потвърждаваме…" : "Потвърди имейла"}
            </button>
          )}
          {!token && !message && (
            <p>
              Липсва линк за потвърждение. Отвори писмото или поискай ново от
              страницата за вход.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <Link className="text-link" href="/account">
            Към входа / нов имейл
          </Link>
        </section>
      }
    </Localize>
  );
}
