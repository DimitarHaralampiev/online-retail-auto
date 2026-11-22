// Product management for administrators: create, edit, publish, unpublish
// and archive storefront products in PostgreSQL.
//
// Every change runs in one transaction that also writes the audit log
// (admin_audit_log) and, when the price changes, the price history
// (product_price_history). Edits carry the content_version the admin loaded;
// a stale version is rejected instead of silently overwriting a colleague's
// change. Stock is never edited here: it only moves through receipts and
// orders (stock_movements).
//
// Callers authorize first: these functions trust `actorId` to be an admin.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";

import type { ProductStatus } from "./admin-product-shared";

export type { ProductStatus };

/** A refused change; `status` is the HTTP status the route returns. */
export class AdminProductError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

type Pool = Pick<pg.Pool, "connect" | "query">;
type Queryable = Pick<pg.PoolClient, "query">;
type Rest<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;

const text = (max: number, message: string) =>
  z.string().trim().max(max, message);

/** Codes for new products: letters, digits, dot, dash and underscore. */
export const newSkuSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
    "Продуктовият код трябва да е до 64 латински букви, цифри, точка, тире или долна черта.",
  );

/** Existing codes (invoice imports may predate the stricter rule). */
export const skuSchema = z
  .string()
  .trim()
  .min(1, "Липсва продуктов код.")
  .max(120, "Невалиден продуктов код.");

const centsSchema = z
  .number()
  .int("Цената трябва да е в цели центове.")
  .min(1, "Цената трябва да е положителна.")
  .max(10_000_000, "Цената е твърде висока.");

export const productInputSchema = z
  .object({
    name: z.object({
      bg: z
        .string()
        .trim()
        .min(2, "Въведи име на български.")
        .max(200, "Името е до 200 знака."),
      en: text(200, "Името е до 200 знака.").default(""),
    }),
    description: z
      .object({
        bg: text(5000, "Описанието е до 5000 знака.").default(""),
        en: text(5000, "Описанието е до 5000 знака.").default(""),
      })
      .default({ bg: "", en: "" }),
    categoryId: z.uuid("Невалидна категория.").nullable().default(null),
    brand: text(120, "Марката е до 120 знака.").default(""),
    manufacturerCode: text(120, "Каталожният номер е до 120 знака.").default(
      "",
    ),
    ean: z
      .string()
      .trim()
      .regex(
        /^(\d{8}|\d{12,14})?$/,
        "Баркодът трябва да е 8, 12, 13 или 14 цифри.",
      )
      .default(""),
    priceCents: centsSchema.nullable().default(null),
    vatBps: z
      .number()
      .int()
      .min(0, "Невалидна ставка на ДДС.")
      .max(10000, "Невалидна ставка на ДДС.")
      .default(2000),
    // Same rule as the warehouse_products_image_path_local constraint.
    imagePath: z
      .string()
      .trim()
      .regex(
        /^\/images\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.(png|jpe?g|webp|avif)$/,
        "Изображението трябва да е път под /images/ (png, jpg, webp или avif).",
      )
      .nullable()
      .default(null),
    weightGrams: z
      .number()
      .int("Теглото е в цели грамове.")
      .min(1, "Теглото трябва да е положително.")
      .max(1_000_000, "Теглото е твърде голямо.")
      .nullable()
      .default(null),
  })
  .refine((input) => !input.description.en || input.name.en, {
    message: "Английското описание изисква и английско име.",
    path: ["name", "en"],
  });
export type ProductInput = z.infer<typeof productInputSchema>;

export const versionSchema = z.number().int().min(1);

export const statusChangeSchema = z.object({
  status: z.enum(["draft", "published", "archived"]),
  version: versionSchema,
});

export type AdminProductSummary = {
  sku: string;
  name: string;
  status: ProductStatus;
  priceCents: number | null;
  categoryName: string | null;
  onHand: number;
  reserved: number;
  version: number;
  updatedAt: string;
};

export type AdminProduct = ProductInput & {
  sku: string;
  status: ProductStatus;
  onHand: number;
  reserved: number;
  version: number;
  updatedAt: string;
};

export const listQuerySchema = z.object({
  status: z.enum(["draft", "published", "archived"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const ADMIN_PAGE_SIZE = 50;

/** Products for the admin list, filtered by status and code/name search. */
export async function listAdminProducts(
  db: Pick<pg.Pool, "query">,
  query: z.infer<typeof listQuerySchema>,
): Promise<{ items: AdminProductSummary[]; total: number }> {
  const search = query.q
    ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    : null;
  const result = await db.query<AdminProductSummary & { total: string }>(
    `SELECT w.sku, coalesce(t.name, w.name) AS name, w.status,
            w.selling_price_cents AS "priceCents",
            coalesce(ct.name, c.slug) AS "categoryName",
            w.on_hand AS "onHand", w.reserved, w.content_version AS version,
            w.content_updated_at AS "updatedAt", count(*) OVER () AS total
     FROM warehouse_products w
     LEFT JOIN product_translations t ON t.sku = w.sku AND t.locale = 'bg'
     LEFT JOIN product_categories c ON c.id = w.category_id
     LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = 'bg'
     WHERE ($1::text IS NULL OR w.status = $1)
       AND ($2::text IS NULL OR w.sku ILIKE $2 OR coalesce(t.name, w.name) ILIKE $2)
     ORDER BY w.content_updated_at DESC, w.sku
     LIMIT $3 OFFSET $4`,
    [
      query.status ?? null,
      search,
      ADMIN_PAGE_SIZE,
      (query.page - 1) * ADMIN_PAGE_SIZE,
    ],
  );
  let total = Number(result.rows[0]?.total ?? 0);
  // Past the last page there are no rows to carry the window count.
  if (!result.rowCount && query.page > 1)
    total = (await listAdminProducts(db, { ...query, page: 1 })).total;
  return {
    items: result.rows.map(({ total: _total, ...row }) => ({
      ...row,
      updatedAt: new Date(row.updatedAt).toISOString(),
    })),
    total,
  };
}

type ProductRow = {
  sku: string;
  name: string;
  brand: string;
  manufacturer_code: string;
  ean: string;
  category_id: string | null;
  status: ProductStatus;
  selling_price_cents: number | null;
  vat_bps: number;
  image_path: string | null;
  weight_grams: number | null;
  on_hand: number;
  reserved: number;
  content_version: number;
  content_updated_at: Date;
  name_bg: string | null;
  name_en: string | null;
  description_bg: string | null;
  description_en: string | null;
};

const PRODUCT_SQL = `SELECT w.*, tb.name AS name_bg, te.name AS name_en,
    tb.description AS description_bg, te.description AS description_en
  FROM warehouse_products w
  LEFT JOIN product_translations tb ON tb.sku = w.sku AND tb.locale = 'bg'
  LEFT JOIN product_translations te ON te.sku = w.sku AND te.locale = 'en'
  WHERE w.sku = $1`;

function toAdminProduct(row: ProductRow): AdminProduct {
  return {
    sku: row.sku,
    name: { bg: row.name_bg ?? row.name, en: row.name_en ?? "" },
    description: {
      bg: row.description_bg ?? "",
      en: row.description_en ?? "",
    },
    categoryId: row.category_id,
    brand: row.brand,
    manufacturerCode: row.manufacturer_code,
    ean: row.ean,
    priceCents: row.selling_price_cents,
    vatBps: row.vat_bps,
    imagePath: row.image_path,
    weightGrams: row.weight_grams,
    status: row.status,
    onHand: row.on_hand,
    reserved: row.reserved,
    version: row.content_version,
    updatedAt: row.content_updated_at.toISOString(),
  };
}

export async function getAdminProduct(
  db: Pick<pg.Pool, "query">,
  sku: string,
): Promise<AdminProduct | null> {
  const result = await db.query<ProductRow>(PRODUCT_SQL, [sku]);
  return result.rows[0] ? toAdminProduct(result.rows[0]) : null;
}

async function transaction<T>(
  pool: Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function audit(
  client: Queryable,
  actorId: string,
  action: string,
  sku: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
     VALUES($1,$2,$3,'product',$4,$5)`,
    [randomUUID(), actorId, action, sku, JSON.stringify(details)],
  );
}

async function recordPrice(
  client: Queryable,
  actorId: string,
  sku: string,
  priceCents: number,
) {
  await client.query(
    `INSERT INTO product_price_history(id,sku,gross_price_cents,source,actor_id)
     VALUES($1,$2,$3,'admin',$4)`,
    [randomUUID(), sku, priceCents, actorId],
  );
}

async function assertCategory(client: Queryable, categoryId: string | null) {
  if (!categoryId) return;
  const found = await client.query(
    `SELECT 1 FROM product_categories c
     LEFT JOIN product_categories parent ON parent.id = c.parent_id
     WHERE c.id = $1 AND (parent.id IS NULL OR parent.parent_id IS NULL)`,
    [categoryId],
  );
  if (!found.rowCount) throw new AdminProductError("Непозната категория.");
}

/**
 * What a product needs before shoppers may see it. Returns the problems in
 * Bulgarian (empty when publishable).
 */
export async function publishProblems(
  client: Queryable,
  product: Pick<ProductInput, "priceCents" | "categoryId">,
): Promise<string[]> {
  const problems: string[] = [];
  if (product.priceCents === null) problems.push("Липсва продажна цена.");
  if (!product.categoryId) problems.push("Липсва категория.");
  else {
    // The storefront only shows products in active categories whose parent
    // (if any) is an active top-level category.
    const visible = await client.query(
      `SELECT 1 FROM product_categories c
       LEFT JOIN product_categories parent ON parent.id = c.parent_id
       WHERE c.id = $1 AND c.active
         AND (parent.id IS NULL OR (parent.active AND parent.parent_id IS NULL))`,
      [product.categoryId],
    );
    if (!visible.rowCount) problems.push("Категорията не е активна.");
  }
  return problems;
}

async function writeTranslations(
  client: Queryable,
  sku: string,
  input: ProductInput,
) {
  await client.query(
    `INSERT INTO product_translations(sku,locale,name,description)
     VALUES($1,'bg',$2,$3)
     ON CONFLICT(sku,locale) DO UPDATE SET name=EXCLUDED.name,
       description=EXCLUDED.description, updated_at=now()`,
    [sku, input.name.bg, input.description.bg],
  );
  if (input.name.en)
    await client.query(
      `INSERT INTO product_translations(sku,locale,name,description)
       VALUES($1,'en',$2,$3)
       ON CONFLICT(sku,locale) DO UPDATE SET name=EXCLUDED.name,
         description=EXCLUDED.description, updated_at=now()`,
      [sku, input.name.en, input.description.en],
    );
  else
    await client.query(
      "DELETE FROM product_translations WHERE sku=$1 AND locale='en'",
      [sku],
    );
}

/** Creates a draft product without stock (stock arrives through receipts). */
export async function createProductIn(
  client: Queryable,
  actorId: string,
  sku: string,
  input: ProductInput,
): Promise<AdminProduct> {
  await assertCategory(client, input.categoryId);
  const inserted = await client.query(
    `INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,
         category_id,status,selling_price_cents,vat_bps,image_path,weight_grams)
       VALUES($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10)
       ON CONFLICT(sku) DO NOTHING RETURNING sku`,
    [
      sku,
      input.name.bg,
      input.brand,
      input.manufacturerCode,
      input.ean,
      input.categoryId,
      input.priceCents,
      input.vatBps,
      input.imagePath,
      input.weightGrams,
    ],
  );
  if (!inserted.rowCount)
    throw new AdminProductError("Продукт с този код вече съществува.", 409);
  await writeTranslations(client, sku, input);
  if (input.priceCents !== null)
    await recordPrice(client, actorId, sku, input.priceCents);
  await audit(client, actorId, "product.create", sku, { input });
  return toAdminProduct(
    (await client.query<ProductRow>(PRODUCT_SQL, [sku])).rows[0],
  );
}

export const createProduct = (
  pool: Pool,
  ...args: Rest<Parameters<typeof createProductIn>>
) => transaction(pool, (client) => createProductIn(client, ...args));

async function lockProduct(
  client: Queryable,
  sku: string,
  version: number,
): Promise<AdminProduct> {
  const result = await client.query<ProductRow>(
    `${PRODUCT_SQL} FOR UPDATE OF w`,
    [sku],
  );
  if (!result.rowCount)
    throw new AdminProductError("Продуктът не е намерен.", 404);
  const product = toAdminProduct(result.rows[0]);
  if (product.version !== version)
    throw new AdminProductError(
      "Продуктът беше променен междувременно. Презареди и опитай отново.",
      409,
    );
  return product;
}

const EDITABLE: (keyof ProductInput)[] = [
  "name",
  "description",
  "categoryId",
  "brand",
  "manufacturerCode",
  "ean",
  "priceCents",
  "vatBps",
  "imagePath",
  "weightGrams",
];

/** Saves an edit made on `version`; a published product must stay publishable. */
export async function updateProductIn(
  client: Queryable,
  actorId: string,
  sku: string,
  version: number,
  input: ProductInput,
): Promise<AdminProduct> {
  const before = await lockProduct(client, sku, version);
  await assertCategory(client, input.categoryId);
  // Only a change of price or category can make a published product
  // invisible; other edits (e.g. a typo) stay possible even if its
  // category was deactivated meanwhile.
  if (
    before.status === "published" &&
    (before.priceCents !== input.priceCents ||
      before.categoryId !== input.categoryId)
  ) {
    const problems = await publishProblems(client, input);
    if (problems.length)
      throw new AdminProductError(
        `Публикуваният продукт трябва да остане видим: ${problems.join(" ")} Свали го от публикация, ако искаш да го промениш така.`,
      );
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of EDITABLE)
    if (JSON.stringify(before[field]) !== JSON.stringify(input[field]))
      changes[field] = { from: before[field], to: input[field] };
  if (!Object.keys(changes).length) return before;
  await client.query(
    `UPDATE warehouse_products SET name=$2, brand=$3, manufacturer_code=$4,
         ean=$5, category_id=$6, selling_price_cents=$7, vat_bps=$8,
         image_path=$9, weight_grams=$10,
         content_version = content_version + 1,
         content_updated_at = now(), updated_at = now()
       WHERE sku=$1`,
    [
      sku,
      input.name.bg,
      input.brand,
      input.manufacturerCode,
      input.ean,
      input.categoryId,
      input.priceCents,
      input.vatBps,
      input.imagePath,
      input.weightGrams,
    ],
  );
  await writeTranslations(client, sku, input);
  if (changes.priceCents && input.priceCents !== null)
    await recordPrice(client, actorId, sku, input.priceCents);
  await audit(client, actorId, "product.update", sku, { changes });
  return toAdminProduct(
    (await client.query<ProductRow>(PRODUCT_SQL, [sku])).rows[0],
  );
}

export const updateProduct = (
  pool: Pool,
  ...args: Rest<Parameters<typeof updateProductIn>>
) => transaction(pool, (client) => updateProductIn(client, ...args));

/**
 * Publishes, unpublishes (draft) or archives a product. Publishing checks
 * that shoppers can actually see and buy it. Reservations of open orders are
 * unaffected: they are fulfilled or released as usual.
 */
export async function setProductStatusIn(
  client: Queryable,
  actorId: string,
  sku: string,
  version: number,
  status: ProductStatus,
): Promise<AdminProduct> {
  const before = await lockProduct(client, sku, version);
  if (before.status === status) return before;
  if (status === "published") {
    const problems = await publishProblems(client, before);
    if (problems.length)
      throw new AdminProductError(
        `Продуктът не може да бъде публикуван: ${problems.join(" ")}`,
      );
  }
  await client.query(
    `UPDATE warehouse_products SET status=$2,
         content_version = content_version + 1,
         content_updated_at = now(), updated_at = now()
       WHERE sku=$1`,
    [sku, status],
  );
  await audit(client, actorId, "product.status", sku, {
    from: before.status,
    to: status,
  });
  return toAdminProduct(
    (await client.query<ProductRow>(PRODUCT_SQL, [sku])).rows[0],
  );
}

export const setProductStatus = (
  pool: Pool,
  ...args: Rest<Parameters<typeof setProductStatusIn>>
) => transaction(pool, (client) => setProductStatusIn(client, ...args));

/** Most recent audit entries for a product (newest first). */
export async function productHistory(
  db: Pick<pg.Pool, "query">,
  sku: string,
  limit = 20,
): Promise<
  {
    action: string;
    actorEmail: string | null;
    details: unknown;
    createdAt: string;
  }[]
> {
  const result = await db.query(
    `SELECT l.action, c.email AS "actorEmail", l.details, l.created_at AS "createdAt"
     FROM admin_audit_log l LEFT JOIN customers c ON c.id = l.actor_id
     WHERE l.entity_type = 'product' AND l.entity_id = $1
     ORDER BY l.created_at DESC, l.id LIMIT $2`,
    [sku, limit],
  );
  return result.rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}
