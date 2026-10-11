"use client";
import { useEffect, useState, type FormEvent } from "react";
import { formatMoney } from "../lib/cart";
import type { DeliverySettings } from "../lib/store-settings";
export default function DeliverySettingsPanel() {
  const [settings, setSettings] = useState<DeliverySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/settings", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setSettings(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setMessage("Правилото за доставка е запазено и важи за новите поръчки.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="customer-form-panel">
      <h2>Кой плаща доставката?</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!settings && !error && <p role="status">Зареждаме настройките…</p>}
      {settings && (
        <form className="customer-form" onSubmit={save}>
          <label className="product-alert-toggle">
            <input
              type="checkbox"
              checked={settings.freeShippingEnabled}
              disabled={busy}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  freeShippingEnabled: e.target.checked,
                })
              }
            />{" "}
            Безплатна доставка над определена стойност
          </label>
          <label>
            Праг на стойността на продуктите (EUR)
            <input
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              required
              disabled={busy || !settings.freeShippingEnabled}
              value={settings.freeShippingAboveCents / 100}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  freeShippingAboveCents: Math.round(
                    Number(e.target.value) * 100,
                  ),
                })
              }
            />
          </label>
          <p>
            {settings.freeShippingEnabled ? (
              <>
                При продукти за{" "}
                <strong>
                  над {formatMoney(settings.freeShippingAboveCents)}
                </strong>{" "}
                доставката е за магазина. До и включително тази сума е за
                клиента.
              </>
            ) : (
              "Клиентът плаща доставката за всяка поръчка."
            )}
          </p>
          <p className="note">
            Стойността е след намаленията, без куриерската такса. Запазеното
            правило важи за Еконт и Спиди, до офис и адрес. Вече създадените
            поръчки запазват потвърдената сума. Куриерските цени засега са
            тестови.
          </p>
          <button className="button" disabled={busy}>
            {busy ? "Запазваме…" : "Запази правилото за доставка"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
