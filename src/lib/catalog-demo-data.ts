// Synthetic demo catalog: illustrative products and EUR prices, not
// commercial offers. Only the static catalog adapter and tests import this.
import type { Product } from "./catalog";

export const demoCategories = [
  "Автоаксесоари",
  "Части и консумативи",
  "Автокозметика",
] as const;

/** URL-safe identifiers for the demo categories (product_categories.slug). */
export const demoCategorySlugs: Record<
  (typeof demoCategories)[number],
  string
> = {
  Автоаксесоари: "car-accessories",
  "Части и консумативи": "parts-consumables",
  Автокозметика: "car-care",
};

export const demoProducts: Product[] = [
  {
    sku: "DEMO-001",
    name: "Органайзер за багажник",
    category: "Автоаксесоари",
    subcategory: {
      id: "organization",
      name: "Организация и багажник",
    },
    description: "Място за всичко необходимо по пътя.",
    image: "/images/organizer.png",
    priceCents: 2990,
    salePriceCents: 2390,
    stock: {
      onHand: 12,
      reserved: 2,
    },
  },
  {
    sku: "DEMO-002",
    name: "Стойка за телефон",
    category: "Автоаксесоари",
    subcategory: {
      id: "phone-holders",
      name: "Стойки за телефон",
    },
    description: "Малък детайл за по-подреден интериор.",
    image: "/images/phone-holder.png",
    priceCents: 1490,
    salePriceCents: 1190,
    stock: {
      onHand: 5,
      reserved: 4,
    },
  },
  {
    sku: "DEMO-003",
    name: "Въздушен филтър",
    category: "Части и консумативи",
    subcategory: {
      id: "filters",
      name: "Филтри",
    },
    description: "Съвместимостта с автомобил предстои да се добави.",
    image: "/images/air-filter.png",
    priceCents: 1890,
    stock: {
      onHand: 8,
      reserved: 0,
    },
  },
  {
    sku: "DEMO-004",
    name: "Комплект чистачки",
    category: "Части и консумативи",
    subcategory: {
      id: "wipers",
      name: "Чистачки",
    },
    description: "Размерите и монтажът предстои да се уточнят.",
    image: "/images/wipers.png",
    priceCents: 2490,
    stock: {
      onHand: 0,
      reserved: 0,
    },
  },
  {
    sku: "DEMO-005",
    name: "Шампоан за автомобил",
    category: "Автокозметика",
    subcategory: {
      id: "washing",
      name: "Измиване и препарати",
    },
    description: "Грижа за автомобила до последния детайл.",
    image: "/images/car-shampoo.png",
    priceCents: 990,
    salePriceCents: 690,
    stock: {
      onHand: 20,
      reserved: 3,
    },
  },
  {
    sku: "DEMO-006",
    name: "Микрофибърна кърпа",
    category: "Автокозметика",
    subcategory: {
      id: "microfiber",
      name: "Кърпи и микрофибър",
    },
    description: "Финалният щрих след всяко почистване.",
    image: "/images/microfiber.png",
    priceCents: 590,
    stock: {
      onHand: 3,
      reserved: 3,
    },
  },
];
