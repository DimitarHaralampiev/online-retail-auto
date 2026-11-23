"use client";
import Localize from "./localize";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  orderStatuses,
  paymentStatuses,
  nextOrderStatuses,
} from "../lib/order-state";
import type { OrderView } from "./order-tracking";
import { formatMoney } from "../lib/cart";
type AdminOrder = OrderView & {
  contact: { name: string; email: string; phone: string };
};
type Refund = {
  id: string;
  orderId: string;
  amountCents: number;
  reason: "paid_after_cancel" | "return";
  paidWith: string | null;
  paymentReference: string | null;
  email: string;
  requestedAt: string;
};
type AdminOrdersData = {
  orders: AdminOrder[];
  pendingEmails: number;
  failedEmails?: number;
  refunds?: Refund[];
};
async function loadAdminOrders(signal?: AbortSignal): Promise<AdminOrdersData> {
  const r = await fetch("/api/admin/orders", { cache: "no-store", signal });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
export default function AdminOrders() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingEmails, setPendingEmails] = useState(0);
  const [failedEmails, setFailedEmails] = useState(0);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  function show(data: AdminOrdersData) {
    setOrders(data.orders);
    setRefunds(data.refunds ?? []);
    setPendingEmails(data.pendingEmails);
    setFailedEmails(data.failedEmails ?? 0);
  }
  async function refresh() {
    show(await loadAdminOrders());
  }
  useEffect(() => {
    const controller = new AbortController();
    loadAdminOrders(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) show(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
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
      // Empty unless the admin opened the legacy handover exception.
      stockOverrideReason:
        String(form.get("stockOverrideReason") ?? "").trim() || undefined,
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
    <Localize>
      {
        <>
          <p className="demo-notice">
            Тестови поръчки. Промяната „Предадена на куриер“ записва етап и
            номер; не създава и не изпраща реална пратка.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p>Чакащи имейли: {pendingEmails}</p>
          {failedEmails > 0 && (
            <div className="error" role="alert">
              <p>Неизпратени след всички опити: {failedEmails}</p>
              <p>
                Провери SMTP настройките и адресите на получателите, после
                изпрати отново.
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => send({ action: "retry-emails" })}
            disabled={busy}
          >
            Изпрати чакащите известия
          </button>
          {refunds.length > 0 && (
            <section
              className="admin-refunds"
              aria-labelledby="admin-refunds-title"
            >
              <h2 id="admin-refunds-title">За възстановяване</h2>
              <p>
                Върни сумата (в Stripe или по банков път) и отбележи го тук.
              </p>
              <ul>
                {refunds.map((refund) => (
                  <li key={refund.id}>
                    <strong>{formatMoney(refund.amountCents)}</strong> ·{" "}
                    <Link href={`/orders/${refund.orderId}`}>
                      #{refund.orderId.slice(0, 8).toUpperCase()}
                    </Link>{" "}
                    · {refund.email} ·{" "}
                    {refund.reason === "return"
                      ? "Върнати артикули"
                      : "Платена след отказ"}
                    {refund.paymentReference && (
                      <>
                        {" "}
                        · <code>{refund.paymentReference}</code>
                      </>
                    )}{" "}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        send({ action: "refund-done", refundId: refund.id })
                      }
                    >
                      Отбелязах като възстановено
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
                        {next.includes("handed_to_courier") && (
                          <details className="handover-override">
                            <summary>
                              Предаване без складово движение (стари поръчки)
                            </summary>
                            <p className="note">
                              Само за поръчки без запазена наличност, чиито
                              бройки складът вече не води. Причината се записва
                              в одита; коригирай наличността отделно.
                            </p>
                            <label>
                              Причина
                              <input
                                name="stockOverrideReason"
                                minLength={5}
                                maxLength={300}
                              />
                            </label>
                          </details>
                        )}
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
      }
    </Localize>
  );
}
