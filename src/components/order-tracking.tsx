"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  orderStatuses,
  paymentStatuses,
  type OrderStatus,
  type PaymentStatus,
} from "../lib/order-state";
import { formatMoney } from "../lib/cart";
import { courierLabels, type Courier } from "../lib/delivery";
export type OrderView = {
  id: string;
  mode: "test";
  status: OrderStatus;
  paymentMethod: "cod" | "card";
  paymentStatus: PaymentStatus;
  paymentUrl: string | null;
  lines: {
    sku: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
  }[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  destination: string;
  courier: Courier;
  trackingNumber: string | null;
  createdAt: string;
};
export default function OrderTracking({ id }: { id: string }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [history, setHistory] = useState<
    { status: OrderStatus; created_at: string }[]
  >([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const token = useRef("");
  useEffect(() => {
    token.current =
      new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    let active = true;
    let controller: AbortController;
    async function refresh() {
      controller?.abort();
      controller = new AbortController();
      try {
        const r = await fetch(`/api/orders/${id}`, {
          headers: token.current ? { "x-order-token": token.current } : {},
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (active) {
          setOrder(data.order);
          setHistory(data.history);
          setError("");
        }
      } catch (e) {
        if (active && !controller.signal.aborted)
          setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    const interval = setInterval(refresh, 15000);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(interval);
    };
  }, [id]);
  return (
    <section className="checkout-panel">
      <p className="demo-notice">
        Тестова поръчка — без реално таксуване или изпращане на пратка.
      </p>
      {loading && <p role="status">Зареждаме поръчката…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {order && (
        <>
          <p className="eyebrow">ПОРЪЧКА / {id.slice(0, 8).toUpperCase()}</p>
          <h2>{orderStatuses[order.status]}</h2>
          <p role="status">Плащане: {paymentStatuses[order.paymentStatus]}</p>
          <ol className="order-timeline">
            {history.map((event, index) => (
              <li key={index}>
                <strong>{orderStatuses[event.status]}</strong>
                <time dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleString("bg-BG")}
                </time>
              </li>
            ))}
          </ol>
          <h3>Твоят избор</h3>
          <ul>
            {order.lines.map((line) => (
              <li key={line.sku}>
                {line.quantity} × {line.name} —{" "}
                {formatMoney(line.unitPriceCents * line.quantity)}
              </li>
            ))}
          </ul>
          <p>
            Доставка: {courierLabels[order.courier]} — {order.destination}
          </p>
          {order.trackingNumber && (
            <p>
              <strong>Товарителница: {order.trackingNumber}</strong>
            </p>
          )}
          <p>
            Продукти: {formatMoney(order.subtotalCents)} · Тестова доставка:{" "}
            {formatMoney(order.shippingCents)}
          </p>
          <p>
            <strong>Общо: {formatMoney(order.totalCents)}</strong>
          </p>
          {order.paymentMethod === "card" &&
            (order.paymentStatus === "pending" ||
              (order.paymentStatus === "failed" &&
                order.paymentUrl?.includes("/payment#"))) &&
            (order.paymentUrl ? (
              <a className="button" href={order.paymentUrl}>
                Продължи към тестово картово плащане
              </a>
            ) : (
              <p>
                Свързването с платежната страница е неуспешно. Свържи се с
                магазина; поръчката остава неплатена.
              </p>
            ))}
          <p className="note">
            Страницата се обновява автоматично. Получаваш и имейл при всеки нов
            етап.
          </p>
        </>
      )}
      <Link className="text-link" href="/catalog">
        Към каталога
      </Link>
    </section>
  );
}
