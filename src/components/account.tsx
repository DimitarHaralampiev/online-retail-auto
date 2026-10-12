"use client";
import Localize from "./localize";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "./account-provider";
import ServicePreferences from "./service-preferences";
import NotificationChoices from "./notification-choices";
import { defaultPreferences } from "../lib/customer-preferences";
import MyOrders from "./my-orders";
export default function Account() {
  const router = useRouter();
  const { customer, ready, mailPreviewUrl, setCustomer } = useAccount();
  const [registrationPreferences, setRegistrationPreferences] =
    useState(defaultPreferences);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
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
                ? {
                    name: value("name"),
                    phone: value("phone"),
                    notificationPreferences: registrationPreferences,
                  }
                : {}),
            },
          };
      const response = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (data.verificationRequired) setVerificationEmail(value("email"));
      if (!response.ok) throw new Error(data.error);
      setCustomer(data.customer ?? null);
      if (!customer && mode === "login" && data.customer) {
        router.replace("/catalog");
        router.refresh();
      }
      setMessage(
        data.message ?? (customer ? "Данните са запазени." : "Успешен вход."),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Опитай отново.");
    } finally {
      setBusy(false);
    }
  }
  async function resend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const email = String(
      new FormData(event.currentTarget).get("verificationEmail") ?? "",
    );
    try {
      const r = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend", email }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setMessage(data.message);
    } catch (e) {
      setError((e as Error).message);
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
  if (!ready)
    return <Localize>{<p role="status">Зареждаме профила…</p>}</Localize>;
  return (
    <Localize>
      {
        <section className="checkout-panel account-panel">
          <h2>
            {customer
              ? "Моят профил"
              : mode === "login"
                ? "Добре дошъл отново."
                : "Създай своя профил."}
          </h2>
          {!customer && mailPreviewUrl && (
            <p className="demo-notice">
              Локален тест: писмата за потвърждение пристигат в{" "}
              <a
                href={mailPreviewUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                тестовата поща
              </a>
              , а не в Gmail. Отвори писмото там и потвърди имейла си преди
              вход.
            </p>
          )}
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
                        mode === "register"
                          ? "new-password"
                          : "current-password"
                      }
                    />
                    <small>Поне 12 символа.</small>
                  </label>
                )}
              </div>
              {!customer && mode === "register" && (
                <section className="registration-services">
                  <h3>Направи профила си по-полезен.</h3>
                  <p>Избери кои имейл услуги искаш. Всички са по желание.</p>
                  <NotificationChoices
                    value={registrationPreferences}
                    onChange={setRegistrationPreferences}
                    disabled={busy}
                  />
                  <p className="note">
                    Любими продукти, „Моят гараж“ и повторни покупки са включени
                    в профила. Можеш да променяш имейл услугите по всяко време.
                  </p>
                  <Link href="/for-you">Разгледай всички услуги</Link>
                </section>
              )}
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
          {!customer && (
            <form onSubmit={resend} className="verification-resend">
              <h3>Не получи писмото?</h3>
              <p className="note">
                Провери Спам. Можеш да поискаш нов линк, който заменя стария.
              </p>
              <label>
                Имейл за потвърждение
                <input
                  name="verificationEmail"
                  value={verificationEmail}
                  onChange={(event) => setVerificationEmail(event.target.value)}
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  disabled={busy}
                />
              </label>
              <button type="submit" className="button" disabled={busy}>
                Изпрати нов линк
              </button>
            </form>
          )}
          {customer && (
            <>
              {customer.isAdmin && (
                <Link className="button" href="/admin">
                  Администрация
                </Link>
              )}
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
          {customer && <ServicePreferences />}
          {customer && <MyOrders customerId={customer.id} />}
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
      }
    </Localize>
  );
}
