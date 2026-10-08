export type Stock = { onHand: number; reserved: number };
export type MovementType = "receipt" | "reserve" | "release" | "sale" | "return";

export function availableStock(stock: Stock): number {
  if (!Number.isSafeInteger(stock.onHand) || !Number.isSafeInteger(stock.reserved) ||
      stock.onHand < 0 || stock.reserved < 0 || stock.reserved > stock.onHand) {
    throw new Error("Невалидна складова наличност.");
  }
  return stock.onHand - stock.reserved;
}

// Real orders must apply movements in a database transaction with a product lock.
// A sale consumes an existing reservation.
export function applyMovement(stock: Stock, type: MovementType, quantity: number): Stock {
  const available = availableStock(stock);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error("Количеството трябва да е положителен брой.");
  }
  let next: Stock;
  switch (type) {
    case "receipt":
    case "return":
      next = { ...stock, onHand: stock.onHand + quantity };
      break;
    case "reserve":
      if (quantity > available) throw new Error("Няма достатъчно свободни бройки.");
      next = { ...stock, reserved: stock.reserved + quantity };
      break;
    case "release":
      if (quantity > stock.reserved) throw new Error("Няма достатъчно резервирани бройки.");
      next = { ...stock, reserved: stock.reserved - quantity };
      break;
    case "sale":
      if (quantity > stock.reserved) throw new Error("Първо резервирай бройките за продажба.");
      next = { onHand: stock.onHand - quantity, reserved: stock.reserved - quantity };
      break;
    default:
      throw new Error("Непознато складово движение.");
  }
  availableStock(next);
  return next;
}
