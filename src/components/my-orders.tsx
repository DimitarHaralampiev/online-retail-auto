"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCart } from "./cart-provider";
import { prepareRepeatOrder } from "../lib/customer-rules";
import { orderStatuses, paymentStatuses } from "../lib/order-state";
import { formatMoney } from "../lib/cart";
import type { OrderView } from "./order-tracking";
export default function MyOrders({ customerId }: { customerId: string }) {
  const { addItems, ready } = useCart();
  const [repeatMessage, setRepeatMessage] = useState("");
  function repeat(order: OrderView) {
    const result = prepareRepeatOrder(order.lines);
    addItems(result.items);
    setRepeatMessage(
      [
        result.items.length
          ? "Наличните продукти са добавени в количката с текущите цени. Провери количествата преди поръчване."
          : "Няма налични продукти за повторна покупка.",
        result.skipped.length
          ? `Пропуснати: ${result.skipped.join(", ")}.`
          : "",
        result.reduced.length
          ? `Ограничени до наличността: ${result.reduced.join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/orders", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setOrders(data.orders);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [customerId]);
  return (
    <section className="my-orders">
      <h3>Моите поръчки</h3>
      {repeatMessage && (
        <p role="status">
          {repeatMessage} <Link href="/cart">Виж количката →</Link>
        </p>
      )}
      {loading && <p role="status">Зареждаме поръчките…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !orders.length && !error && (
        <p>Още няма поръчки, направени с този профил.</p>
      )}
      <ul>
        {orders.map((order) => (
          <li key={order.id}>
            <Link href={`/orders/${order.id}`}>
              #{order.id.slice(0, 8).toUpperCase()} ·{" "}
              {orderStatuses[order.status]}
            </Link>
            <p>
              {formatMoney(order.totalCents)} ·{" "}
              {paymentStatuses[order.paymentStatus]}
            </p>
            <button
              className="text-link"
              disabled={!ready}
              onClick={() => repeat(order)}
            >
              Добави продуктите отново →
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
