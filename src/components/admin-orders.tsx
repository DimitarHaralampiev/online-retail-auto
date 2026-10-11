"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  orderStatuses,
  paymentStatuses,
  nextOrderStatuses,
  type OrderStatus,
} from "../lib/order-state";
import type { OrderView } from "./order-tracking";
import { formatMoney } from "../lib/cart";
type AdminOrder = OrderView & {
  contact: { name: string; email: string; phone: string };
};
export default function AdminOrders() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingEmails, setPendingEmails] = useState(0);
  async function refresh() {
    const r = await fetch("/api/admin/orders", { cache: "no-store" });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    setOrders(data.orders);
    setPendingEmails(data.pendingEmails);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  async function change(
    event: React.FormEvent<HTMLFormElement>,
    order: AdminOrder,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await send({
      id: order.id,
      expectedStatus: order.status,
      status: String(form.get("status")),
      trackingNumber: String(form.get("trackingNumber") ?? ""),
    });
  }
  async function send(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="demo-notice">
        Тестови поръчки. Промяната „Предадена на куриер“ записва етап и номер;
        не създава и не изпраща реална пратка.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>Чакащи имейли: {pendingEmails}</p>
      <button
        type="button"
        onClick={() => send({ action: "retry-emails" })}
        disabled={busy}
      >
        Изпрати чакащите известия
      </button>
      <div className="admin-order-list">
        {orders.map((order) => {
          const next = nextOrderStatuses(order.status).filter(
            (status) =>
              !(
                order.paymentMethod === "card" &&
                (status === "cancelled" || order.paymentStatus !== "paid")
              ),
          );
          return (
            <article className="checkout-panel" key={order.id}>
              <h2>
                #{order.id.slice(0, 8).toUpperCase()} ·{" "}
                {orderStatuses[order.status]}
              </h2>
              <p>
                {order.contact.name} · {order.contact.email} ·{" "}
                {order.contact.phone}
              </p>
              <p>{order.destination}</p>
              <p>
                {formatMoney(order.totalCents)} ·{" "}
                {paymentStatuses[order.paymentStatus]}
              </p>
              <Link href={`/orders/${order.id}`}>Преглед на историята</Link>
              {next.length > 0 && (
                <form onSubmit={(event) => change(event, order)}>
                  <fieldset className="checkout-fields" disabled={busy}>
                    <div className="form-grid">
                      <label>
                        Следващ етап
                        <select name="status" key={order.status}>
                          {next.map((status) => (
                            <option key={status} value={status}>
                              {orderStatuses[status]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Номер на товарителница
                        <input
                          name="trackingNumber"
                          maxLength={80}
                          defaultValue={order.trackingNumber ?? ""}
                        />
                      </label>
                    </div>
                    <button className="button" type="submit">
                      Запази етапа и уведоми клиента
                    </button>
                  </fieldset>
                </form>
              )}
            </article>
          );
        })}
      </div>
      {!orders.length && !error && <p>Все още няма тестови поръчки.</p>}
    </>
  );
}
