"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart } from "./cart-provider";
import { cartSubtotal, formatMoney } from "../lib/cart";
import {
  courierLabels,
  demoOfficeCities,
  demoOffices,
  paymentLabels,
  type Courier,
} from "../lib/delivery";
import type { CheckoutInput, CheckoutPreview } from "../lib/checkout";
import Icon from "./icon";

export default function Checkout() {
  const { items, ready, storageWarning } = useCart();
  const [courier, setCourier] = useState<Courier>("speedy");
  const [deliveryType, setDeliveryType] = useState<"office" | "address">(
    "office",
  );
  const [city, setCity] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [officeSearch, setOfficeSearch] = useState("");
  const [payment, setPayment] = useState<"cod" | "card">("cod");
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const offices = demoOffices.filter(
    (office) =>
      office.courier === courier &&
      office.city === city &&
      office.name
        .toLocaleLowerCase("bg")
        .includes(officeSearch.trim().toLocaleLowerCase("bg")),
  );

  useEffect(() => {
    setPreview(null);
    setBusy(false);
    requestRef.current?.abort();
    return () => requestRef.current?.abort();
  }, [items]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPreview(null);
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const input: CheckoutInput = {
      items,
      contact: {
        name: value("name"),
        email: value("email"),
        phone: value("phone"),
      },
      delivery:
        deliveryType === "office"
          ? { type: "office", courier, city, officeId }
          : {
              type: "address",
              courier,
              city,
              postalCode: value("postalCode"),
              street: value("street"),
              number: value("number"),
              details: value("details"),
            },
      payment,
    };
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/checkout/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.error === "string" ? data.error : "Неуспешна проверка.",
        );
      if (data.mode !== "demo" || data.orderCreated !== false)
        throw new Error("Невалиден отговор от сървъра.");
      setPreview(data as CheckoutPreview);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Провери връзката и опитай отново.",
        );
    } finally {
      if (requestRef.current === controller) setBusy(false);
    }
  }

  if (!ready) return <p role="status">Зареждаме количката…</p>;
  if (!items.length)
    return (
      <div className="empty-cart">
        <h2>Първо избери своите продукти.</h2>
        <Link className="button" href="/catalog">
          Към каталога <Icon name="arrow" />
        </Link>
      </div>
    );

  return (
    <>
      {storageWarning && <p className="demo-notice">{storageWarning}</p>}
      <div className="checkout-grid">
        <form
          className="checkout-form"
          onSubmit={submit}
          onChange={() => setPreview(null)}
        >
          <fieldset className="checkout-fields" disabled={busy}>
            <section className="checkout-panel">
              <h2>
                <span>01</span> Данни за получателя
              </h2>
              <p className="note">
                Използвай тестови данни за тази демонстрация.
              </p>
              <div className="form-grid">
                <label className="full-width">
                  Име и фамилия
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={120}
                  />
                </label>
                <label>
                  Имейл
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                  />
                </label>
                <label>
                  Телефон
                  <input
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    required
                    maxLength={30}
                    placeholder="Напр. 0888 123 456"
                  />
                </label>
              </div>
            </section>
            <section className="checkout-panel">
              <h2>
                <span>02</span> Доставка
              </h2>
              <fieldset className="choice-group">
                <legend>Куриер</legend>
                <div className="choice-grid">
                  {(Object.keys(courierLabels) as Courier[]).map((value) => (
                    <label
                      className={`choice-card ${courier === value ? "selected" : ""}`}
                      key={value}
                    >
                      <input
                        type="radio"
                        name="courier"
                        aria-label={courierLabels[value]}
                        value={value}
                        checked={courier === value}
                        onChange={() => {
                          setCourier(value);
                          setOfficeId("");
                          setOfficeSearch("");
                        }}
                      />
                      <span>
                        <strong>{courierLabels[value]}</strong>
                        <small>До офис или адрес</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="choice-group">
                <legend>Начин на доставка</legend>
                <div className="choice-grid">
                  {(["office", "address"] as const).map((value) => (
                    <label
                      className={`choice-card ${deliveryType === value ? "selected" : ""}`}
                      key={value}
                    >
                      <input
                        type="radio"
                        name="deliveryType"
                        aria-label={value === "office" ? "До офис" : "До адрес"}
                        checked={deliveryType === value}
                        onChange={() => {
                          setDeliveryType(value);
                          setCity("");
                          setOfficeId("");
                          setOfficeSearch("");
                        }}
                      />
                      <span>
                        <strong>
                          {value === "office" ? "До офис" : "До адрес"}
                        </strong>
                        <small>
                          {value === "office"
                            ? "Избери удобен офис"
                            : "На посочено място"}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {deliveryType === "office" ? (
                <div className="form-grid">
                  <label>
                    Град
                    <select
                      aria-label="Град"
                      required
                      value={city}
                      onChange={(event) => {
                        setCity(event.target.value);
                        setOfficeId("");
                        setOfficeSearch("");
                      }}
                    >
                      <option value="">Избери град</option>
                      {demoOfficeCities.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Търси тестов офис
                    <input
                      type="search"
                      value={officeSearch}
                      onChange={(event) => {
                        setOfficeSearch(event.target.value);
                        setOfficeId("");
                      }}
                      disabled={!city}
                      placeholder="Напр. Център"
                    />
                  </label>
                  <label className="full-width">
                    Офис на {courierLabels[courier]}
                    <select
                      aria-label="Офис"
                      required
                      value={officeId}
                      disabled={!city}
                      onChange={(event) => setOfficeId(event.target.value)}
                    >
                      <option value="">Избери тестов офис</option>
                      {offices.map((office) => (
                        <option value={office.id} key={office.id}>
                          {office.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {city && offices.length === 0 && (
                    <p className="note full-width">
                      Няма съвпадащи тестови офиси. Промени търсенето.
                    </p>
                  )}
                  <p className="note full-width">
                    Това са измислени тестови офиси. Реалният списък ще идва от
                    избрания куриер.
                  </p>
                </div>
              ) : (
                <div className="form-grid">
                  <label>
                    Населено място
                    <input
                      name="city"
                      required
                      maxLength={120}
                      autoComplete="address-level2"
                      value={city}
                      onChange={(event) => setCity(event.target.value)}
                    />
                  </label>
                  <label>
                    Пощенски код
                    <input
                      name="postalCode"
                      required
                      pattern="[0-9]{4}"
                      inputMode="numeric"
                      maxLength={4}
                      autoComplete="postal-code"
                    />
                  </label>
                  <label>
                    Улица или квартал
                    <input
                      name="street"
                      required
                      maxLength={120}
                      autoComplete="address-line1"
                    />
                  </label>
                  <label>
                    Номер или блок
                    <input name="number" required maxLength={30} />
                  </label>
                  <label className="full-width">
                    Вход, етаж, апартамент · по желание
                    <input
                      name="details"
                      maxLength={200}
                      autoComplete="address-line2"
                    />
                  </label>
                </div>
              )}
            </section>
            <section className="checkout-panel">
              <h2>
                <span>03</span> Начин на плащане
              </h2>
              <fieldset className="choice-group">
                <legend>Плащане</legend>
                <div className="choice-grid">
                  {(["cod", "card"] as const).map((value) => (
                    <label
                      className={`choice-card ${payment === value ? "selected" : ""}`}
                      key={value}
                    >
                      <input
                        type="radio"
                        name="payment"
                        aria-label={paymentLabels[value]}
                        checked={payment === value}
                        onChange={() => setPayment(value)}
                      />
                      <span>
                        <strong>{paymentLabels[value]}</strong>
                        <small>
                          {value === "cod"
                            ? "При получаване"
                            : "Онлайн · предстои свързване"}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="note">
                {payment === "card"
                  ? "Картовото плащане ще преминава през защитена страница на платежен доставчик. В тази демонстрация не въвеждай данни за карта."
                  : "В демонстрацията само записваме избора. Реалният наложен платеж ще се заявява към куриера."}
              </p>
            </section>
            <button className="button" type="submit">
              {busy ? "Проверяваме…" : "Преглед на демо поръчката"}
              <Icon name="arrow" />
            </button>
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {preview && (
            <section
              className="preview-result"
              aria-label="Преглед на демо поръчката"
            >
              <h2>Данните са проверени.</h2>
              <p role="status">
                Това е преглед. Не е създадена поръчка и не е извършено плащане.
              </p>
              <dl>
                <div>
                  <dt>Куриер</dt>
                  <dd>{preview.courier}</dd>
                </div>
                <div>
                  <dt>Получаване</dt>
                  <dd>{preview.destination}</dd>
                </div>
                <div>
                  <dt>Плащане</dt>
                  <dd>{preview.payment}</dd>
                </div>
                <div>
                  <dt>Продукти · демо цени</dt>
                  <dd>{formatMoney(preview.subtotalCents)}</dd>
                </div>
                <div>
                  <dt>Доставка и окончателна сума</dt>
                  <dd>Предстои изчисляване</dd>
                </div>
              </dl>
            </section>
          )}
        </form>
        <aside className="order-summary" aria-label="Обобщение на поръчката">
          <p className="eyebrow">ТВОЯТ ИЗБОР</p>
          <h2>Преди финала</h2>
          <dl>
            <div>
              <dt>Бройки</dt>
              <dd>{items.reduce((sum, item) => sum + item.quantity, 0)}</dd>
            </div>
            <div>
              <dt>Продукти · демо цени</dt>
              <dd>{formatMoney(cartSubtotal(items))}</dd>
            </div>
            <div>
              <dt>Доставка</dt>
              <dd>Предстои изчисляване</dd>
            </div>
          </dl>
          <p className="note">
            Доставката и евентуалните платежни такси ще се включат в
            окончателната сума преди реално потвърждение.
          </p>
          <Link className="text-link" href="/cart">
            Редактирай количката <Icon name="arrow" />
          </Link>
        </aside>
      </div>
    </>
  );
}
