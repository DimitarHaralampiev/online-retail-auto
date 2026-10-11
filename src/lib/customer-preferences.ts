import { z } from "zod";
export const notificationPreferencesSchema = z
  .object({ price: z.boolean(), stock: z.boolean(), reminders: z.boolean() })
  .strict();
export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;
export const defaultPreferences = (): NotificationPreferences => ({
  price: false,
  stock: false,
  reminders: false,
});
export const notificationServices = [
  {
    key: "price" as const,
    title: "Намаления на избрани продукти",
    description: "Имейл, когато цената на продукт, който следиш, падне.",
  },
  {
    key: "stock" as const,
    title: "Отново наличен",
    description:
      "Еднократен имейл, когато избран изчерпан продукт стане наличен.",
  },
  {
    key: "reminders" as const,
    title: "Напомняния за автомобила",
    description:
      "Имейл на датата, която зададеш за смяна на консуматив или друга грижа.",
  },
];
