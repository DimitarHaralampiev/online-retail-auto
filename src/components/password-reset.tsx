"use client";
// Sets a new password from the emailed link (#47). The token arrives in the
// URL fragment and is removed from the address bar right away.
import Localize from "./localize";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function PasswordReset() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    // Reading the address is only possible after mounting.
    setToken(new URLSearchParams(location.hash.slice(1)).get("token") ?? "");
    history.replaceState(history.state, "", location.pathname);
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get("password") ?? "");
    if (password !== String(fields.get("confirm") ?? ""))
      return setError("Паролите не съвпадат.");
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", token, password }),
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
          <h2>Нова парола</h2>
          {token && (
            <form onSubmit={submit} className="form-grid">
              <label className="full-width">
                Нова парола
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <small>Поне 12 символа.</small>
              </label>
              <label className="full-width">
                Повтори новата парола
                <input
                  name="confirm"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <button className="button" type="submit" disabled={busy}>
                {busy ? "Моля, изчакай…" : "Запази новата парола"}
              </button>
            </form>
          )}
          {!token && !message && (
            <p>
              Липсва линк за нова парола. Отвори писмото или поискай нов линк от
              страницата за вход.
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p role="status">
              {message} <Link href="/account">Към вход →</Link>
            </p>
          )}
        </section>
      }
    </Localize>
  );
}
