// Fuel names for display; the keys are the reference's fuels (vehicles.ts).
import type { Fuel } from "./vehicles";

export const FUEL_LABELS: Record<Fuel, [bg: string, en: string]> = {
  petrol: ["Бензин", "Petrol"],
  diesel: ["Дизел", "Diesel"],
  hybrid: ["Хибрид", "Hybrid"],
  "plug-in-hybrid": ["Плъг-ин хибрид", "Plug-in hybrid"],
  electric: ["Електрически", "Electric"],
  lpg: ["Газ (LPG)", "LPG"],
  cng: ["Метан (CNG)", "CNG"],
  other: ["Друго", "Other"],
};
