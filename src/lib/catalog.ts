import type { Stock } from "./inventory";

export const categories = [
  "Автоаксесоари",
  "Части и консумативи",
  "Автокозметика",
] as const;
export type Product = {
  sku: string;
  name: string;
  category: (typeof categories)[number];
  description: string;
  image: string;
  stock: Stock;
};

// Synthetic demo data; no supplier, price or compatibility claims.
export const demoProducts: Product[] = [
  {
    sku: "DEMO-001",
    name: "Органайзер за багажник",
    category: "Автоаксесоари",
    description: "Място за всичко необходимо по пътя.",
    image: "/images/organizer.png",
    stock: { onHand: 12, reserved: 2 },
  },
  {
    sku: "DEMO-002",
    name: "Стойка за телефон",
    category: "Автоаксесоари",
    description: "Малък детайл за по-подреден интериор.",
    image: "/images/phone-holder.png",
    stock: { onHand: 5, reserved: 4 },
  },
  {
    sku: "DEMO-003",
    name: "Въздушен филтър",
    category: "Части и консумативи",
    description: "Съвместимостта с автомобил предстои да се добави.",
    image: "/images/air-filter.png",
    stock: { onHand: 8, reserved: 0 },
  },
  {
    sku: "DEMO-004",
    name: "Комплект чистачки",
    category: "Части и консумативи",
    description: "Размерите и монтажът предстои да се уточнят.",
    image: "/images/wipers.png",
    stock: { onHand: 0, reserved: 0 },
  },
  {
    sku: "DEMO-005",
    name: "Шампоан за автомобил",
    category: "Автокозметика",
    description: "Грижа за автомобила до последния детайл.",
    image: "/images/car-shampoo.png",
    stock: { onHand: 20, reserved: 3 },
  },
  {
    sku: "DEMO-006",
    name: "Микрофибърна кърпа",
    category: "Автокозметика",
    description: "Финалният щрих след всяко почистване.",
    image: "/images/microfiber.png",
    stock: { onHand: 3, reserved: 3 },
  },
];
