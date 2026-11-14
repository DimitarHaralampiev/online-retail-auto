// Synthetic demo catalog: illustrative products and EUR prices, not
// commercial offers. Only the static catalog adapter and tests import this.
import type { Product, ProductCategory } from "./catalog";

/** Demo categories in display order; `id` is the product_categories slug. */
export const demoCategories: ProductCategory[] = [
  { id: "car-accessories", name: "Автоаксесоари" },
  { id: "parts-consumables", name: "Части и консумативи" },
  { id: "car-care", name: "Автокозметика" },
];

const [accessories, parts, care] = demoCategories;

export const demoProducts: Product[] = [
  {
    sku: "DEMO-001",
    name: "Органайзер за багажник",
    category: accessories,
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
    category: accessories,
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
    category: parts,
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
    category: parts,
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
    category: care,
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
    category: care,
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
