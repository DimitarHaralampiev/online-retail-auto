export const courierLabels = { speedy: "Спиди", econt: "Еконт" } as const;
export type Courier = keyof typeof courierLabels;
export type Office = {
  id: string;
  courier: Courier;
  city: string;
  name: string;
};

// Fictional fixtures. Never send these IDs to either courier's live API.
export const demoOffices: Office[] = (
  Object.keys(courierLabels) as Courier[]
).flatMap((courier) =>
  ["София", "Пловдив", "Варна"].flatMap((city, cityIndex) => [
    {
      id: `DEMO-${courier}-${cityIndex}-1`,
      courier,
      city,
      name: `Тестов офис — ${city}, Център`,
    },
    {
      id: `DEMO-${courier}-${cityIndex}-2`,
      courier,
      city,
      name: `Тестов офис — ${city}, Изток`,
    },
  ]),
);

export const demoOfficeCities = ["София", "Пловдив", "Варна"];
export const paymentLabels = {
  cod: "Наложен платеж",
  card: "Банкова карта",
} as const;
