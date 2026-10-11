import { publicSpeedyOffices } from "./speedy-public";
import { z } from "zod";
import { type Courier, type Office, demoOffices } from "./delivery";
const econtSchema = z.object({
  offices: z.array(
    z.object({
      id: z.number(),
      code: z.string(),
      name: z.string(),
      isAPS: z.boolean().optional(),
      isMPS: z.boolean().optional(),
      address: z.object({
        city: z.object({
          name: z.string(),
          country: z.object({ code3: z.string() }),
        }),
        fullAddress: z.string(),
      }),
      shipmentTypes: z.array(z.string()).optional(),
    }),
  ),
});
const speedySchema = z.object({
  offices: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      address: z.object({
        siteName: z.string(),
        fullAddressString: z.string().optional(),
        countryId: z.number().optional(),
      }),
    }),
  ),
  error: z.unknown().optional(),
});
export function parseOffices(courier: Courier, value: unknown): Office[] {
  if (courier === "econt")
    return econtSchema
      .parse(value)
      .offices.filter(
        (o) =>
          o.address.city.country.code3 === "BGR" &&
          !o.isAPS &&
          !o.isMPS &&
          (!o.shipmentTypes || o.shipmentTypes.includes("courier")),
      )
      .map((o) => ({
        id: o.code,
        courier,
        city: o.address.city.name,
        name: `${o.name} — ${o.address.fullAddress}`,
      }));
  const data = speedySchema.parse(value);
  if (data.error) throw new Error("Courier request failed");
  return data.offices
    .filter((o) => !o.address.countryId || o.address.countryId === 100)
    .map((o) => ({
      id: String(o.id),
      courier,
      city: o.address.siteName,
      name: `${o.name}${o.address.fullAddressString ? " — " + o.address.fullAddressString : ""}`,
    }));
}
const cache = new Map<Courier, { expires: number; value: Office[] }>();
const pending = new Map<Courier, Promise<Office[]>>();
export function officeMode() {
  return process.env.COURIER_OFFICES_MODE === "demo" ? "demo" : "live";
}
export async function courierOffices(courier: Courier): Promise<Office[]> {
  if (officeMode() === "demo")
    return demoOffices.filter((o) => o.courier === courier);
  const cached = cache.get(courier);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (pending.has(courier)) return pending.get(courier)!;
  const load = (async () => {
    if (
      courier === "speedy" &&
      (!process.env.SPEEDY_API_USER || !process.env.SPEEDY_API_PASSWORD)
    ) {
      const value = await publicSpeedyOffices();
      cache.set(courier, { expires: Date.now() + 3600000, value });
      return value;
    }
    const response = await fetch(
      courier === "econt"
        ? "https://ee.econt.com/services/Nomenclatures/NomenclaturesService.getOffices.json"
        : "https://api.speedy.bg/v1/location/office",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          courier === "econt"
            ? { countryCode: "BGR" }
            : {
                userName: process.env.SPEEDY_API_USER,
                password: process.env.SPEEDY_API_PASSWORD,
                language: "BG",
                countryId: 100,
                officeType: "OFFICE",
              },
        ),
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      },
    );
    if (!response.ok)
      throw new Error(
        "Куриерът временно не е достъпен. Опитай отново или избери доставка до адрес.",
      );
    const value = parseOffices(courier, await response.json());
    if (!value.length)
      throw new Error("Няма достъпни офиси. Избери доставка до адрес.");
    cache.set(courier, { expires: Date.now() + 3600000, value });
    return value;
  })();
  pending.set(courier, load);
  try {
    return await load;
  } finally {
    pending.delete(courier);
  }
}
