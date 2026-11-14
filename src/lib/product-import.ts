// Bulk product import from CSV: a dry run reports what every row would do,
// with row-level errors; apply performs exactly the same work and commits it
// only when no row has an error (all or nothing).
//
// Both modes run the identical code inside one transaction (a dry run rolls
// it back), so the preview cannot drift from the real import. Rows are
// processed in SKU order, the lock order shared with orders and receipts, so
// an import cannot deadlock with checkout. Each row runs in a savepoint: a
// failed row is undone and reported while the others continue to be checked.
//
// Semantics per row:
// - New SKU: created as a draft (name_bg required), then given `status`.
//   `stock` books an opening receipt (with `unit_cost` for inventory value).
// - Existing SKU: non-empty cells replace the current value; empty cells keep
//   it. Stock of existing products only changes through invoices and orders.
//
// Product rules (validation, publishing, audit, price history) are the ones
// of admin product management (admin-products.ts).
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { ZodError } from "zod";
import {
  AdminProductError,
  createProductIn,
  getAdminProduct,
  newSkuSchema,
  productInputSchema,
  setProductStatusIn,
  updateProductIn,
  type AdminProduct,
  type ProductStatus,
} from "./admin-products";
import {
  parseEuros,
  parsePercentBps,
  parseWholeNumber,
} from "./admin-product-shared";
import { compareSku } from "./stock-reservations";
import { CsvError, parseCsv } from "./csv";

export const IMPORT_COLUMNS = [
  "sku",
  "name_bg",
  "name_en",
  "description_bg",
  "description_en",
  "category",
  "brand",
  "manufacturer_code",
  "ean",
  "price",
  "vat",
  "weight_grams",
  "image_path",
  "status",
  "stock",
  "unit_cost",
] as const;
type Column = (typeof IMPORT_COLUMNS)[number];

// About 25 s per 2000 new rows (one transaction); larger catalogs are split.
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_STOCK = 1_000_000;

export type RowResult = {
  line: number;
  sku: string;
  action: "create" | "update" | "unchanged" | "error";
  errors: string[];
};

export type ImportReport = {
  applied: boolean;
  /** File-level problem (header, format); no rows were processed. */
  error?: string;
  rows: RowResult[];
  summary: Record<RowResult["action"], number>;
};

type Pool = Pick<pg.Pool, "connect">;
type Client = pg.PoolClient;

const STATUSES: Record<string, ProductStatus> = {
  draft: "draft",
  published: "published",
  archived: "archived",
  чернова: "draft",
  публикуван: "published",
  архивиран: "archived",
};

function emptyReport(error: string): ImportReport {
  return {
    applied: false,
    error,
    rows: [],
    summary: { create: 0, update: 0, unchanged: 0, error: 0 },
  };
}

/** Thrown inside a row to report it without aborting the import. */
class RowError extends Error {}

function number(
  value: string,
  parse: (v: string) => number | null,
  message: string,
): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = parse(value);
  if (parsed === null || Number.isNaN(parsed)) throw new RowError(message);
  return parsed;
}

async function processRow(
  client: Client,
  actorId: string,
  batchId: string,
  values: Partial<Record<Column, string>>,
  categories: Map<string, string>,
): Promise<RowResult["action"]> {
  const cell = (column: Column) => values[column]?.trim() ?? "";
  const sku = cell("sku");
  const categorySlug = cell("category");
  const categoryId = categorySlug ? categories.get(categorySlug) : undefined;
  if (categorySlug && !categoryId)
    throw new RowError(`Непозната категория „${categorySlug}“.`);
  const statusText = cell("status").toLowerCase();
  const status = statusText ? STATUSES[statusText] : undefined;
  if (statusText && !status)
    throw new RowError("Статусът е draft, published или archived.");
  const price = number(
    cell("price"),
    parseEuros,
    "Цената трябва да е сума в евро, напр. 45,90.",
  );
  const vatBps = number(
    cell("vat"),
    parsePercentBps,
    "ДДС трябва да е процент, напр. 20.",
  );
  const weight = number(
    cell("weight_grams"),
    parseWholeNumber,
    "Теглото трябва да е цяло число грамове.",
  );
  const stock = number(
    cell("stock"),
    parseWholeNumber,
    "Наличността трябва да е цяло число.",
  );
  const unitCost = number(
    cell("unit_cost"),
    parseEuros,
    "Себестойността трябва да е сума в евро.",
  );
  if (stock !== undefined && stock > MAX_STOCK)
    throw new RowError("Наличността надхвърля допустимия лимит.");
  if (unitCost !== undefined && !stock)
    throw new RowError("Себестойност се задава заедно с наличност.");

  const locked = await client.query<{ content_version: number }>(
    "SELECT content_version FROM warehouse_products WHERE sku = $1 FOR UPDATE",
    [sku],
  );
  const existing = locked.rowCount
    ? ((await getAdminProduct(client, sku)) as AdminProduct)
    : null;
  if (existing && stock !== undefined)
    throw new RowError(
      "Наличността на съществуващ продукт се променя само чрез фактури и поръчки.",
    );
  const pick = (column: Column, current: string) => cell(column) || current;
  const input = productInputSchema.parse({
    name: {
      bg: pick("name_bg", existing?.name.bg ?? ""),
      en: pick("name_en", existing?.name.en ?? ""),
    },
    description: {
      bg: pick("description_bg", existing?.description.bg ?? ""),
      en: pick("description_en", existing?.description.en ?? ""),
    },
    categoryId: categoryId ?? existing?.categoryId ?? null,
    brand: pick("brand", existing?.brand ?? ""),
    manufacturerCode: pick(
      "manufacturer_code",
      existing?.manufacturerCode ?? "",
    ),
    ean: pick("ean", existing?.ean ?? ""),
    priceCents: price ?? existing?.priceCents ?? null,
    vatBps: vatBps ?? existing?.vatBps ?? 2000,
    imagePath: cell("image_path") || existing?.imagePath || null,
    weightGrams: weight ?? existing?.weightGrams ?? null,
  });

  let product: AdminProduct;
  let action: RowResult["action"];
  if (existing) {
    product = await updateProductIn(
      client,
      actorId,
      sku,
      existing.version,
      input,
    );
    action = product.version === existing.version ? "unchanged" : "update";
  } else {
    newSkuSchema.parse(sku);
    product = await createProductIn(client, actorId, sku, input);
    action = "create";
    if (stock) {
      const valueCents = (unitCost ?? 0) * stock;
      await client.query(
        `INSERT INTO stock_movements(id,sku,kind,quantity,reference_key,unit_cost_cents,note)
         VALUES($1,$2,'receipt',$3,$4,$5,'CSV import opening stock')`,
        [
          randomUUID(),
          sku,
          stock,
          `import:${batchId}:${sku}`,
          unitCost ?? null,
        ],
      );
      await client.query(
        `UPDATE warehouse_products SET on_hand = $2, inventory_value_cents = $3,
           updated_at = now() WHERE sku = $1`,
        [sku, stock, valueCents],
      );
    }
  }
  if (status && status !== product.status) {
    await setProductStatusIn(client, actorId, sku, product.version, status);
    if (action === "unchanged") action = "update";
  }
  return action;
}

function rowErrors(error: unknown): string[] | null {
  if (error instanceof RowError || error instanceof AdminProductError)
    return [error.message];
  if (error instanceof ZodError)
    return error.issues.map((issue) => issue.message);
  // PostgreSQL refuses NUL characters in text.
  if ((error as { code?: string }).code === "22021")
    return ["Текстът съдържа недопустими знаци."];
  return null;
}

/**
 * Checks (apply = false) or performs (apply = true) an import. Returns a
 * report; throws only for unexpected failures (e.g. the database is down).
 */
export async function importProducts(
  pool: Pool,
  actorId: string,
  csv: string,
  options: { apply: boolean; filename?: string },
): Promise<ImportReport> {
  let table;
  try {
    table = parseCsv(csv, MAX_IMPORT_ROWS);
  } catch (error) {
    if (error instanceof CsvError) return emptyReport(error.message);
    throw error;
  }
  const unknown = table.header.filter(
    (name) => !(IMPORT_COLUMNS as readonly string[]).includes(name),
  );
  if (unknown.length)
    return emptyReport(`Непознати колони: ${unknown.join(", ")}.`);
  if (!table.header.includes("sku")) return emptyReport("Липсва колона sku.");
  if (new Set(table.header).size !== table.header.length)
    return emptyReport("Има повторени колони.");
  if (!table.rows.length) return emptyReport("Файлът няма редове с данни.");

  const results: RowResult[] = [];
  const pending: {
    result: RowResult;
    values: Partial<Record<Column, string>>;
  }[] = [];
  const seen = new Map<string, number>();
  for (const { line, cells } of table.rows) {
    const values: Partial<Record<Column, string>> = {};
    table.header.forEach(
      (name, i) => (values[name as Column] = cells[i] ?? ""),
    );
    const sku = values.sku?.trim() ?? "";
    const result: RowResult = { line, sku, action: "error", errors: [] };
    results.push(result);
    if (cells.length > table.header.length)
      result.errors.push("Редът има повече клетки от заглавието.");
    else if (!sku) result.errors.push("Липсва продуктов код (sku).");
    else if (sku.length > 120) result.errors.push("Невалиден продуктов код.");
    else if (seen.has(sku))
      result.errors.push(`Кодът се повтаря (ред ${seen.get(sku)}).`);
    else {
      seen.set(sku, line);
      pending.push({ result, values });
    }
  }

  const client = await pool.connect();
  const batchId = randomUUID();
  try {
    await client.query("BEGIN");
    const categories = new Map(
      (
        await client.query<{ id: string; slug: string }>(
          "SELECT id, slug FROM product_categories",
        )
      ).rows.map((row) => [row.slug, row.id]),
    );
    pending.sort((a, b) => compareSku(a.result.sku, b.result.sku));
    for (const { result, values } of pending) {
      await client.query("SAVEPOINT import_row");
      try {
        result.action = await processRow(
          client,
          actorId,
          batchId,
          values,
          categories,
        );
        await client.query("RELEASE SAVEPOINT import_row");
      } catch (error) {
        const messages = rowErrors(error);
        if (!messages) throw error;
        await client.query("ROLLBACK TO SAVEPOINT import_row");
        result.errors.push(...messages);
      }
    }
    const summary = { create: 0, update: 0, unchanged: 0, error: 0 };
    for (const result of results) {
      if (result.errors.length) result.action = "error";
      summary[result.action] += 1;
    }
    const applied = options.apply && summary.error === 0;
    if (applied) {
      await client.query(
        `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
         VALUES($1,$2,'product.import','import',$3,$4)`,
        [
          batchId,
          actorId,
          batchId,
          JSON.stringify({ filename: options.filename ?? null, summary }),
        ],
      );
      await client.query("COMMIT");
    } else await client.query("ROLLBACK");
    return { applied, rows: results, summary };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
