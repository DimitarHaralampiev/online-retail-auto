"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCustomerFeatures } from "./customer-provider";
import { type NotificationPreferences } from "../lib/customer-preferences";
import NotificationChoices from "./notification-choices";
export default function ServicePreferences() {
  const { data, ready, busy, error: loadError, mutate } = useCustomerFeatures();
  const [edited, setValue] = useState<NotificationPreferences | null>(null);
  const value = edited ?? data.preferences;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => setValue(null), [data.preferences]);
  async function save() {
    setError("");
    setMessage("");
    try {
      await mutate({ action: "preferences", preferences: value });
      setMessage("Изборът ти е запазен.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!ready || loadError)
    return (
      <section className="customer-services-panel" id="services">
        <h3>Моите услуги</h3>
        {loadError ? (
          <p className="error" role="alert">
            {loadError} Презареди страницата, за да опиташ отново.
          </p>
        ) : (
          <p role="status">Зареждаме запазените настройки…</p>
        )}
      </section>
    );
  return (
    <section className="customer-services-panel" id="services">
      <p className="eyebrow">ПО ТВОЙ ИЗБОР</p>
      <h3>Моите услуги</h3>
      <div className="customer-inline-actions">
        <Link href="/favorites">Любими →</Link>
        <Link href="/garage">Моят гараж →</Link>
      </div>
      <p>
        Любимите, гаражът и повторните покупки са винаги достъпни. Тук избираш
        кои допълнителни имейли да получаваш.
      </p>
      <NotificationChoices
        value={value}
        onChange={setValue}
        disabled={!ready || busy}
      />
      <p className="note">
        Избираш конкретните продукти и дати отделно. Тези настройки не спират
        писмата за регистрация и поръчки.
      </p>
      <button className="button" disabled={!ready || busy} onClick={save}>
        {busy ? "Запазваме…" : "Запази моите услуги"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <Link className="text-link" href="/for-you">
        Виж всички възможности
      </Link>
    </section>
  );
}
