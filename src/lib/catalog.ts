import type { Stock } from "./inventory";

export const categories = ["Автоаксесоари", "Части и консумативи", "Автокозметика"] as const;
export type Product = {
  sku: string;
  name: string;
  category: (typeof categories)[number];
  description: string;
  stock: Stock;
};

// Synthetic demo data; no supplier, price or compatibility claims.
export const demoProducts: Product[] = [
  { sku: "DEMO-001", name: "Органайзер за багажник", category: "Автоаксесоари", description: "Примерен аксесоар за подреждане на багажника.", stock: { onHand: 12, reserved: 2 } },
  { sku: "DEMO-002", name: "Стойка за телефон", category: "Автоаксесоари", description: "Примерен продукт за интериора на автомобила.", stock: { onHand: 5, reserved: 4 } },
  { sku: "DEMO-003", name: "Въздушен филтър", category: "Части и консумативи", description: "Съвместимостта с автомобил предстои да се добави.", stock: { onHand: 8, reserved: 0 } },
  { sku: "DEMO-004", name: "Комплект чистачки", category: "Части и консумативи", description: "Размерите и монтажът предстои да се уточнят.", stock: { onHand: 0, reserved: 0 } },
  { sku: "DEMO-005", name: "Шампоан за автомобил", category: "Автокозметика", description: "Примерен продукт за външно почистване.", stock: { onHand: 20, reserved: 3 } },
  { sku: "DEMO-006", name: "Микрофибърна кърпа", category: "Автокозметика", description: "Примерен консуматив за грижа за автомобила.", stock: { onHand: 3, reserved: 3 } },
];
