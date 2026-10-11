export const orderStatuses = {
  received: "Получена",
  confirmed: "Потвърдена",
  preparing: "Подготвя се",
  ready: "Готова за изпращане",
  handed_to_courier: "Предадена на куриер",
  cancelled: "Отказана",
} as const;
export type OrderStatus = keyof typeof orderStatuses;
export const paymentStatuses = {
  pending: "Очаква плащане",
  paid: "Платена (тест)",
  due_on_delivery: "Наложен платеж при получаване",
  failed: "Плащането не е завършено",
} as const;
export type PaymentStatus = keyof typeof paymentStatuses;
export function nextOrderStatuses(status: OrderStatus): OrderStatus[] {
  const next: Partial<Record<OrderStatus, OrderStatus>> = {
    received: "confirmed",
    confirmed: "preparing",
    preparing: "ready",
    ready: "handed_to_courier",
  };
  if (status === "handed_to_courier" || status === "cancelled") return [];
  return [next[status]!, "cancelled"];
}
export function validateTransition(
  order: {
    status: OrderStatus;
    payment_method: "cod" | "card";
    payment_status: PaymentStatus;
  },
  next: OrderStatus,
  tracking?: string,
) {
  if (!nextOrderStatuses(order.status).includes(next))
    throw new Error("Невалидна промяна на етапа. Обнови поръчката.");
  if (
    order.payment_method === "card" &&
    order.payment_status !== "paid" &&
    next !== "cancelled"
  )
    throw new Error("Първо трябва да е потвърдено картовото плащане.");
  if (order.payment_method === "card" && next === "cancelled")
    throw new Error(
      "Отказът на картова поръчка изисква отделен процес за отказ или възстановяване на плащането.",
    );
  if (next === "handed_to_courier" && !tracking?.trim())
    throw new Error("Попълни номер на товарителница.");
}
export function validPayment(
  order: { id: string; total_cents: number; stripe_session_id: string | null },
  session: {
    id: string;
    livemode: boolean;
    currency: string | null;
    amount_total: number | null;
    payment_status: string;
    metadata: Record<string, string> | null;
    client_reference_id: string | null;
  },
) {
  return (
    !session.livemode &&
    session.currency === "eur" &&
    session.amount_total === order.total_cents &&
    session.payment_status === "paid" &&
    session.metadata?.orderId === order.id &&
    session.client_reference_id === order.id &&
    (!order.stripe_session_id || order.stripe_session_id === session.id)
  );
}
