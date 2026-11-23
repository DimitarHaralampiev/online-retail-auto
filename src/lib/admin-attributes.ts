// Attribute definitions for administrators (#103): create, rename and
// translate, set the unit and order, and choose which ones shoppers can
// filter by. Keys appear in catalog URLs and CSV columns, so they are fixed
// at creation; definitions are never deleted (products reference them).
//
// Every change runs in one transaction with an audit entry and is guarded by
// content_version, like category edits (admin-categories.ts).
//
// Callers authorize first: these functions trust `actorId` to be an admin.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { AdminProductError } from "./admin-products";
import { ATTRIBUTE_KEY, isAttributeKey, MAX_ATTRIBUTE_KEY } from "./attributes";

type Pool = Pick<pg.Pool, "connect" | "query">;

export const attributeKeySchema = z
  .string()
  .trim()
  .regex(
    ATTRIBUTE_KEY,
    "Ключът трябва да е от малки латински букви, цифри и тирета.",
  )
  .max(MAX_ATTRIBUTE_KEY, "Ключът е до 40 знака.")
  .refine(isAttributeKey, "Този ключ е запазен. Избери друг.");

const label = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .refine(
      (value) => !/[\u0000-\u001f]/.test(value),
      "Текстът съдържа недопустими знаци.",
    );

export const attributeInputSchema = z.object({
  name: z.object({
    bg: label(60, "Името е до 60 знака.").refine(
      (value) => value.length >= 2,
      "Въведи име на български.",
    ),
    en: label(60, "Името е до 60 знака.").default(""),
  }),
  unit: label(20, "Мерната единица е до 20 знака.").default(""),
  sortOrder: z
    .number()
    .int("Подредбата е цяло число.")
    .min(0, "Подредбата е от 0 до 10000.")
    .max(10000, "Подредбата е от 0 до 10000.")
    .default(0),
  filterable: z.boolean().default(true),
});
export type AttributeInput = z.infer<typeof attributeInputSchema>;

export type AttributeDefinition = AttributeInput & {
  key: string;
  version: number;
  /** Products that have a value. */
  products: number;
};

const LIST_SQL = `
SELECT d.key, d.name_bg, d.name_en, d.unit, d.sort_order, d.filterable,
       d.content_version,
       (SELECT count(*)::int FROM product_attributes a WHERE a.key = d.key) AS products
FROM attribute_definitions d`;

type Row = {
  key: string;
  name_bg: string;
  name_en: string;
  unit: string;
  sort_order: number;
  filterable: boolean;
  content_version: number;
  products: number;
};

const toDefinition = (row: Row): AttributeDefinition => ({
  key: row.key,
  name: { bg: row.name_bg, en: row.name_en },
  unit: row.unit,
  sortOrder: row.sort_order,
  filterable: row.filterable,
  version: row.content_version,
  products: row.products,
});

export async function listAttributes(
  db: Pick<pg.Pool, "query">,
): Promise<AttributeDefinition[]> {
  const result = await db.query<Row>(
    `${LIST_SQL} ORDER BY d.sort_order, d.key`,
  );
  return result.rows.map(toDefinition);
}

async function change(
  pool: Pool,
  actorId: string,
  key: string,
  action: "attribute.create" | "attribute.update",
  work: (client: pg.PoolClient) => Promise<Record<string, unknown>>,
): Promise<AttributeDefinition> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const details = await work(client);
    await client.query(
      `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
       VALUES($1,$2,$3,'attribute',$4,$5)`,
      [randomUUID(), actorId, action, key, JSON.stringify(details)],
    );
    const saved = await client.query<Row>(`${LIST_SQL} WHERE d.key = $1`, [
      key,
    ]);
    await client.query("COMMIT");
    return toDefinition(saved.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const values = (input: AttributeInput) => [
  input.name.bg,
  input.name.en,
  input.unit,
  input.sortOrder,
  input.filterable,
];

export const createAttribute = (
  pool: Pool,
  actorId: string,
  key: string,
  input: AttributeInput,
) =>
  change(pool, actorId, key, "attribute.create", async (client) => {
    const inserted = await client.query(
      `INSERT INTO attribute_definitions(key,name_bg,name_en,unit,sort_order,filterable)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(key) DO NOTHING RETURNING key`,
      [key, ...values(input)],
    );
    if (!inserted.rowCount)
      throw new AdminProductError("Характеристика с този ключ вече има.", 409);
    return { input };
  });

export const updateAttribute = (
  pool: Pool,
  actorId: string,
  key: string,
  version: number,
  input: AttributeInput,
) =>
  change(pool, actorId, key, "attribute.update", async (client) => {
    const found = await client.query<Row>(
      `${LIST_SQL} WHERE d.key = $1 FOR UPDATE OF d`,
      [key],
    );
    if (!found.rows[0])
      throw new AdminProductError("Характеристиката не е намерена.", 404);
    const before = toDefinition(found.rows[0]);
    if (before.version !== version)
      throw new AdminProductError(
        "Характеристиката беше променена междувременно. Презареди и опитай отново.",
        409,
      );
    await client.query(
      `UPDATE attribute_definitions SET name_bg=$2, name_en=$3, unit=$4,
         sort_order=$5, filterable=$6, content_version=content_version+1,
         updated_at=now() WHERE key=$1`,
      [key, ...values(input)],
    );
    return { from: before, to: input };
  });

export type ProductSpec = { key: string; name: string; text: string };

/** A product's attributes for its page, in display order. */
export async function productSpecs(
  db: Pick<pg.Pool, "query">,
  sku: string,
  locale: "bg" | "en",
): Promise<ProductSpec[]> {
  const result = await db.query<ProductSpec>(
    `SELECT d.key,
            CASE WHEN $2 = 'en' AND d.name_en <> '' THEN d.name_en ELSE d.name_bg END AS name,
            a.value || CASE WHEN d.unit <> '' THEN ' ' || d.unit ELSE '' END AS text
     FROM product_attributes a JOIN attribute_definitions d ON d.key = a.key
     WHERE a.sku = $1 ORDER BY d.sort_order, d.key`,
    [sku, locale],
  );
  return result.rows;
}
