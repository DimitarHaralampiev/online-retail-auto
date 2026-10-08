"use client";
import Link from "next/link";
import { useState } from "react";
import { useAccount } from "./account-provider";
export default function Account() {
  const { customer, ready, setCustomer } = useAccount();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = customer
        ? {
            action: "profile",
            profile: {
              name: value("name"),
              phone: value("phone"),
              delivery: customer.delivery,
            },
          }
        : {
            action: mode,
            credentials: {
              email: value("email"),
              password: value("password"),
              ...(mode === "register"
                ? { name: value("name"), phone: value("phone") }
                : {}),
            },
          };
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCustomer(data.customer);
      setMessage(customer ? "Данните са запазени." : "Успешен вход.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Опитай отново.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!r.ok) throw new Error("Неуспешен изход. Опитай отново.");
      setCustomer(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ready) return <p role="status">Зареждаме профила…</p>;
  return (
    <section className="checkout-panel account-panel">
      <h2>
        {customer
          ? "Моят профил"
          : mode === "login"
            ? "Добре дошъл отново."
            : "Създай своя профил."}
      </h2>
      {!customer && (
        <div className="account-tabs">
          <button
            type="button"
            aria-pressed={mode === "login"}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            Вход
          </button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            onClick={() => {
              setMode("register");
              setError("");
            }}
          >
            Регистрация
          </button>
        </div>
      )}
      <form onSubmit={submit} key={customer?.id ?? mode}>
        <fieldset className="checkout-fields" disabled={busy}>
          <div className="form-grid">
            {(customer || mode === "register") && (
              <>
                <label className="full-width">
                  Име и фамилия
                  <input
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="name"
                    defaultValue={customer?.name}
                  />
                </label>
                <label>
                  Телефон
                  <input
                    name="phone"
                    type="tel"
                    required
                    maxLength={30}
                    autoComplete="tel"
                    defaultValue={customer?.phone}
                  />
                </label>
              </>
            )}
            <label className={customer ? "full-width" : ""}>
              Имейл
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                defaultValue={customer?.email}
                readOnly={!!customer}
              />
            </label>
            {!customer && (
              <label className="full-width">
                Парола
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                />
                <small>Поне 12 символа.</small>
              </label>
            )}
          </div>
          <button className="button" type="submit">
            {busy
              ? "Моля, изчакай…"
              : customer
                ? "Запази данните"
                : mode === "login"
                  ? "Влез в профила"
                  : "Създай профил"}
          </button>
        </fieldset>
      </form>
      {customer && (
        <>
          <p className="note">
            Предпочитаната доставка се запазва от формата за поръчка.{" "}
            {customer.delivery
              ? `Запазена доставка: ${customer.delivery.city}.`
              : "Още няма запазена доставка."}
          </p>
          <button
            type="button"
            className="text-link"
            onClick={logout}
            disabled={busy}
          >
            Изход от профила
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <Link className="text-link" href="/checkout">
        {customer ? "Продължи към поръчката" : "Продължи като гост"}
      </Link>
    </section>
  );
}
