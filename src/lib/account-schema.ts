import { z } from "zod";
import { checkoutSchema } from "./checkout";
export const profileSchema = z
  .object({
    name: checkoutSchema.shape.contact.shape.name,
    phone: checkoutSchema.shape.contact.shape.phone,
    delivery: checkoutSchema.shape.delivery.nullable(),
  })
  .strict();
export const credentialsSchema = z
  .object({
    email: z
      .email("Попълни валиден имейл.")
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z
      .string()
      .min(12, "Паролата трябва да е поне 12 символа.")
      .max(128),
  })
  .strict();
export const registrationSchema = credentialsSchema.extend({
  name: profileSchema.shape.name,
  phone: profileSchema.shape.phone,
});
export type Customer = {
  id: string;
  email: string;
  name: string;
  phone: string;
  delivery: z.infer<typeof profileSchema>["delivery"];
};
