import { z } from "zod";
import { demoProducts } from "./catalog";
import { availableStock } from "./inventory";
import { demoOffices, courierLabels, paymentLabels } from "./delivery";

const text = (label: string, maximum = 120) =>
  z
    .string()
    .trim()
    .min(1, `Попълни ${label}.`)
    .max(maximum, `${label}: твърде дълъг текст.`);
const courier = z.enum(["speedy", "econt"]);
const cartItem = z
  .object({
    sku: text("продуктов код", 50),
    quantity: z.number().int().min(1).max(50),
  })
  .strict();

export const checkoutSchema = z
  .object({
    items: z.array(cartItem).min(1, "Количката е празна.").max(50),
    contact: z
      .object({
        name: text("име и фамилия"),
        email: z.email("Попълни валиден имейл.").max(254),
        phone: z
          .string()
          .trim()
          .max(30)
          .transform((value) => value.replace(/[\s()\-]/g, ""))
          .pipe(
            z
              .string()
              .regex(
                /^(?:\+359|00359|0)[0-9]{8,9}$/,
                "Попълни валиден български телефон.",
              ),
          ),
      })
      .strict(),
    delivery: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("office"),
          courier,
          city: text("град"),
          officeId: text("офис", 60),
        })
        .strict(),
      z
        .object({
          type: z.literal("address"),
          courier,
          city: text("населено място"),
          postalCode: z
            .string()
            .trim()
            .regex(/^\d{4}$/, "Пощенският код трябва да е от 4 цифри."),
          street: text("улица или квартал"),
          number: text("номер или блок", 30),
          details: z.string().trim().max(200),
        })
        .strict(),
    ]),
    payment: z.enum(["cod", "card"]),
  })
  .strict();

export type CheckoutInput = z.input<typeof checkoutSchema>;
export type CheckoutPreview = {
  mode: "demo";
  orderCreated: false;
  paymentStatus: "not_started";
  subtotalCents: number;
  shippingCents: null;
  totalCents: null;
  courier: string;
  destination: string;
  payment: string;
};

// Prices and stock come from our catalog, never from client-supplied totals.
// This is a read-only preview: it does not reserve stock or create an order.
export function previewCheckout(value: unknown): CheckoutPreview {
  const input = checkoutSchema.parse(value);
  const quantities = new Map<string, number>();
  for (const item of input.items)
    quantities.set(item.sku, (quantities.get(item.sku) ?? 0) + item.quantity);
  let subtotalCents = 0;
  for (const [sku, quantity] of quantities) {
    const product = demoProducts.find((item) => item.sku === sku);
    if (!product) throw new Error("Количката съдържа непознат продукт.");
    if (quantity > availableStock(product.stock) || quantity > 50)
      throw new Error(`Недостатъчна наличност: ${product.name}.`);
    subtotalCents += product.demoPriceCents * quantity;
  }
  let destination: string;
  if (input.delivery.type === "office") {
    const delivery = input.delivery;
    const office = demoOffices.find(
      (item) =>
        item.id === delivery.officeId &&
        item.courier === delivery.courier &&
        item.city === delivery.city,
    );
    if (!office)
      throw new Error("Избраният офис не отговаря на куриера и града.");
    destination = office.name;
  } else {
    destination = `${input.delivery.postalCode} ${input.delivery.city}, ${input.delivery.street} ${input.delivery.number}${input.delivery.details ? ", " + input.delivery.details : ""}`;
  }
  return {
    mode: "demo",
    orderCreated: false,
    paymentStatus: "not_started",
    subtotalCents,
    shippingCents: null,
    totalCents: null,
    courier: courierLabels[input.delivery.courier],
    destination,
    payment: paymentLabels[input.payment],
  };
}
