import {
  notificationPreferencesSchema,
  defaultPreferences,
  type NotificationPreferences,
} from "./customer-preferences";
import { z } from "zod";
import { demoProducts, type Product } from "./catalog";
import { availableStock } from "./inventory";
export const todayInSofia = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const name = z.string().trim().min(1, "Попълни полето.").max(80);
export const vehicleSchema = z
  .object({
    nickname: z.string().trim().max(40),
    make: name,
    model: name,
    year: z
      .number()
      .int()
      .min(1900)
      .max(new Date().getFullYear() + 1),
    engine: name,
  })
  .strict();
export const reminderSchema = z
  .object({
    vehicleId: z.uuid(),
    title: name,
    lastServiceDate: z.iso.date().nullable(),
    dueDate: z.iso.date(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.dueDate < todayInSofia())
      ctx.addIssue({
        code: "custom",
        message: "Избери днешна или бъдеща дата.",
      });
    if (
      r.lastServiceDate &&
      (r.lastServiceDate > todayInSofia() || r.lastServiceDate > r.dueDate)
    )
      ctx.addIssue({
        code: "custom",
        message: "Провери датата на последната смяна.",
      });
  });
const sku = z
  .string()
  .max(50)
  .refine(
    (value) => demoProducts.some((p) => p.sku === value),
    "Непознат продукт.",
  );
export const customerActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("preferences"),
      preferences: notificationPreferencesSchema,
    })
    .strict(),
  z
    .object({ action: z.literal("favorite"), sku, enabled: z.boolean() })
    .strict(),
  z
    .object({
      action: z.literal("import-favorites"),
      skus: z.array(sku).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("alert"),
      sku,
      kind: z.enum(["stock", "price"]),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({ action: z.literal("add-vehicle"), vehicle: vehicleSchema })
    .strict(),
  z.object({ action: z.literal("select-vehicle"), id: z.uuid() }).strict(),
  z.object({ action: z.literal("delete-vehicle"), id: z.uuid() }).strict(),
  z
    .object({ action: z.literal("add-reminder"), reminder: reminderSchema })
    .strict(),
  z.object({ action: z.literal("delete-reminder"), id: z.uuid() }).strict(),
]);
export type Vehicle = {
  id: string;
  nickname: string;
  make: string;
  model: string;
  year: number;
  engine: string;
  selected: boolean;
};
export type Reminder = {
  id: string;
  vehicleId: string;
  title: string;
  dueDate: string;
  lastServiceDate: string | null;
  notifiedAt: string | null;
};
export type ProductAlert = {
  sku: string;
  kind: "stock" | "price";
  active: boolean;
};
export type CustomerFeatures = {
  preferences: NotificationPreferences;
  favorites: string[];
  alerts: ProductAlert[];
  vehicles: Vehicle[];
  reminders: Reminder[];
  compatibleSkus: string[];
};
export const emptyFeatures = (): CustomerFeatures => ({
  preferences: defaultPreferences(),
  favorites: [],
  alerts: [],
  vehicles: [],
  reminders: [],
  compatibleSkus: [],
});
export function fitmentMatches(
  vehicle: Vehicle,
  fitment: {
    make: string;
    model: string;
    engine: string;
    year_from: number;
    year_to: number;
  },
) {
  const key = (v: string) => v.trim().toLocaleLowerCase("bg");
  return (
    key(vehicle.make) === key(fitment.make) &&
    key(vehicle.model) === key(fitment.model) &&
    key(vehicle.engine) === key(fitment.engine) &&
    vehicle.year >= fitment.year_from &&
    vehicle.year <= fitment.year_to
  );
}
export function prepareRepeatOrder(
  lines: { sku: string; quantity: number }[],
  products: Product[] = demoProducts,
) {
  const items: { sku: string; quantity: number }[] = [];
  const skipped: string[] = [];
  const reduced: string[] = [];
  const quantities = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) continue;
    quantities.set(line.sku, (quantities.get(line.sku) ?? 0) + line.quantity);
  }
  for (const [id, requested] of quantities) {
    const product = products.find((p) => p.sku === id);
    const quantity = product
      ? Math.min(requested, availableStock(product.stock), 50)
      : 0;
    if (!quantity) {
      skipped.push(product?.name ?? id);
      continue;
    }
    if (quantity < requested) reduced.push(product!.name);
    items.push({ sku: id, quantity });
  }
  return { items, skipped, reduced };
}
