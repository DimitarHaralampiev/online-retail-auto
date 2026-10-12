"use client";
import Localize from "./localize";
import { useLocale } from "./locale-provider";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAccount } from "./account-provider";
import { useCustomerFeatures } from "./customer-provider";
import { todayInSofia } from "../lib/customer-rules";
export default function Garage() {
  const { locale } = useLocale();
  const { customer, ready: accountReady } = useAccount();
  const { data, ready, busy, error: loadError, mutate } = useCustomerFeatures();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function act(value: unknown) {
    setError("");
    setMessage("");
    try {
      await mutate(value);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  async function addVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      await act({
        action: "add-vehicle",
        vehicle: {
          nickname: fields.get("nickname"),
          make: fields.get("make"),
          model: fields.get("model"),
          engine: fields.get("engine"),
          year: Number(fields.get("year")),
        },
      })
    ) {
      form.reset();
      setMessage("Автомобилът е добавен.");
    }
  }
  async function addReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (
      await act({
        action: "add-reminder",
        reminder: {
          vehicleId: fields.get("vehicleId"),
          title: fields.get("title"),
          lastServiceDate: fields.get("lastServiceDate") || null,
          dueDate: fields.get("dueDate"),
        },
      })
    ) {
      form.reset();
      setMessage("Напомнянето е запазено.");
    }
  }
  if (!accountReady || !ready)
    return <Localize>{<p role="status">Зареждаме гаража…</p>}</Localize>;
  if (!customer)
    return (
      <Localize>
        {
          <div className="benefits-control">
            <h2>Свой профил. Свой гараж.</h2>
            <p>
              Влез или се регистрирай, за да запазиш автомобилите и напомнянията
              си.
            </p>
            <Link className="button" href="/account">
              Вход / Регистрация
            </Link>
          </div>
        }
      </Localize>
    );
  return (
    <Localize>
      {
        <>
          <div aria-live="polite">
            {(error || loadError) && (
              <p className="error" role="alert">
                {error || loadError}
              </p>
            )}
            {message && <p>{message}</p>}
          </div>
          <div className="garage-grid">
            <section>
              <h2>Моите автомобили</h2>
              <p>
                До 10 автомобила. Избраният се използва от филтъра в каталога.
              </p>
              {!data.vehicles.length && (
                <p className="empty">Добави първия си автомобил.</p>
              )}
              <div className="vehicle-list">
                {data.vehicles.map((v) => (
                  <article
                    className={`vehicle-card ${v.selected ? "is-selected" : ""}`}
                    key={v.id}
                  >
                    <small>
                      {v.selected ? "ИЗБРАН АВТОМОБИЛ" : "В ТВОЯ ГАРАЖ"}
                    </small>
                    <h3>{v.nickname || `${v.make} ${v.model}`}</h3>
                    <p>
                      {v.make} {v.model} · {v.year}
                      <br />
                      {v.engine}
                    </p>
                    <div className="customer-inline-actions">
                      <button
                        className="button button-light"
                        disabled={busy || v.selected}
                        onClick={() =>
                          act({ action: "select-vehicle", id: v.id })
                        }
                      >
                        {v.selected ? "Избран" : "Избери"}
                      </button>
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Да изтрия автомобила и напомнянията му?",
                            )
                          )
                            void act({ action: "delete-vehicle", id: v.id });
                        }}
                      >
                        Изтрий
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <Link className="text-link" href="/catalog">
                Към каталога →
              </Link>
            </section>
            <section className="customer-form-panel">
              <h2>Добави автомобил</h2>
              <form className="customer-form" onSubmit={addVehicle}>
                <label>
                  Име в гаража (по желание)
                  <input
                    name="nickname"
                    maxLength={40}
                    placeholder="Моята кола"
                  />
                </label>
                <label>
                  Марка
                  <input
                    name="make"
                    required
                    maxLength={80}
                    placeholder="Например Volkswagen"
                  />
                </label>
                <label>
                  Модел
                  <input
                    name="model"
                    required
                    maxLength={80}
                    placeholder="Например Golf VII"
                  />
                </label>
                <label>
                  Година
                  <input
                    type="number"
                    name="year"
                    required
                    min={1900}
                    max={new Date().getFullYear() + 1}
                    placeholder="2018"
                  />
                </label>
                <label>
                  Двигател
                  <input
                    name="engine"
                    required
                    maxLength={80}
                    placeholder="Например 1.6 TDI, 85 kW"
                  />
                </label>
                <button
                  className="button"
                  disabled={busy || data.vehicles.length >= 10}
                >
                  Запази автомобила
                </button>
              </form>
              <p className="note">
                Съвместимост показваме само при проверени данни за точния модел,
                година и двигател. Все още няма такива данни за демо продуктите.
              </p>
            </section>
          </div>
          <section className="garage-reminders">
            <p className="eyebrow">СЛЕДВАЩО ОБСЛУЖВАНЕ</p>
            <h2>Помни важните дати.</h2>
            <p>
              Ти определяш датата за обслужване. Не изчисляваме сервизни
              интервали автоматично.
            </p>
            {!data.preferences.reminders && (
              <p className="note">
                Имейлите за напомняния са изключени. Можеш да записваш дати тук
                и да ги разрешиш от{" "}
                <Link href="/account#services">„Моите услуги“</Link>.
              </p>
            )}
            <div className="garage-grid">
              <div>
                {!data.reminders.length && (
                  <p className="empty">Още няма записани напомняния.</p>
                )}
                {data.reminders.map((r) => {
                  const v = data.vehicles.find((v) => v.id === r.vehicleId);
                  return (
                    <article className="reminder-card" key={r.id}>
                      <time dateTime={r.dueDate}>
                        {new Date(`${r.dueDate}T12:00:00`).toLocaleDateString(
                          locale === "en" ? "en-GB" : "bg-BG",
                        )}
                      </time>
                      <h3>{r.title}</h3>
                      <p>{v?.nickname || `${v?.make} ${v?.model}`}</p>
                      {r.lastServiceDate && (
                        <p>Последно обслужване: {r.lastServiceDate}</p>
                      )}
                      <small>
                        {r.notifiedAt
                          ? "Известието е поставено за изпращане."
                          : data.preferences.reminders
                            ? "Напомнянето е активно."
                            : "Имейлите са изключени."}
                      </small>
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() =>
                          act({ action: "delete-reminder", id: r.id })
                        }
                      >
                        Изтрий напомнянето
                      </button>
                    </article>
                  );
                })}
              </div>
              <form
                className="customer-form customer-form-panel"
                onSubmit={addReminder}
              >
                <h3>Ново напомняне</h3>
                <label>
                  Автомобил
                  <select name="vehicleId" required defaultValue="">
                    <option value="" disabled>
                      Избери автомобил
                    </option>
                    {data.vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nickname || `${v.make} ${v.model}`} · {v.year}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  За какво да напомним
                  <input
                    name="title"
                    required
                    maxLength={80}
                    placeholder="Смяна на масло и филтри"
                  />
                </label>
                <label>
                  Последно обслужване (по желание)
                  <input
                    type="date"
                    name="lastServiceDate"
                    max={todayInSofia()}
                  />
                </label>
                <label>
                  Следващо обслужване
                  <input
                    type="date"
                    name="dueDate"
                    min={todayInSofia()}
                    required
                  />
                </label>
                <button
                  className="button"
                  disabled={
                    busy || !data.vehicles.length || data.reminders.length >= 50
                  }
                >
                  Запази напомнянето
                </button>
              </form>
            </div>
          </section>
        </>
      }
    </Localize>
  );
}
