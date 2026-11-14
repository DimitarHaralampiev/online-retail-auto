// Category management for administrators: create, rename and translate,
// reorder, move between parents and activate or deactivate categories.
//
// The storefront shows two levels (category > subcategory), so a parent must
// be a top-level category and a category with subcategories stays top-level.
// Slugs are the storefront's category ids (they appear in catalog URLs), so
// they are fixed at creation. Categories are never deleted: products and
// history reference them; deactivating hides them and their products.
//
// Every change runs in one transaction with an audit entry and is guarded by
// content_version, like product edits (admin-products.ts).
//
// Callers authorize first: these functions trust `actorId` to be an admin.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { AdminProductError } from "./admin-products";

type Pool = Pick<pg.Pool, "connect" | "query">;
type Queryable = Pick<pg.PoolClient, "query">;

export const categorySlugSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Адресът на категорията трябва да е от малки латински букви, цифри и тирета.",
  )
  .min(2, "Адресът на категорията е твърде кратък.")
  .max(60, "Адресът на категорията е до 60 знака.");

const noNul = (value: string) => !value.includes("\u0000");

export const categoryInputSchema = z.object({
  name: z.object({
    bg: z
      .string()
      .trim()
      .min(2, "Въведи име на български.")
      .max(100, "Името е до 100 знака.")
      .refine(noNul, "Текстът съдържа недопустими знаци."),
    en: z
      .string()
      .trim()
      .max(100, "Името е до 100 знака.")
      .refine(noNul, "Текстът съдържа недопустими знаци.")
      .default(""),
  }),
  parentId: z.uuid("Невалидна родителска категория.").nullable().default(null),
  sortOrder: z
    .number()
    .int("Подредбата е цяло число.")
    .min(0, "Подредбата е от 0 до 10000.")
    .max(10000, "Подредбата е от 0 до 10000.")
    .default(0),
  active: z.boolean().default(true),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export type AdminCategory = {
  id: string;
  slug: string;
  name: string;
  nameEn: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  version: number;
  /**
   * Products filed directly under this category, by status, and published
   * products it shows including its subcategories (all hidden when it is
   * deactivated).
   */
  products: { published: number; other: number; publishedInTree: number };
  subcategories: number;
};

const CATEGORY_SQL = `
SELECT c.id, c.slug, coalesce(tb.name, c.slug) AS name,
       coalesce(te.name, '') AS "nameEn", c.parent_id AS "parentId",
       c.sort_order AS "sortOrder", c.active, c.content_version AS version,
       (SELECT count(*)::int FROM warehouse_products w
         WHERE w.category_id = c.id AND w.status = 'published') AS published,
       (SELECT count(*)::int FROM warehouse_products w
         WHERE w.category_id = c.id AND w.status <> 'published') AS other,
       (SELECT count(*)::int FROM warehouse_products w
         JOIN product_categories wc ON wc.id = w.category_id
         WHERE (wc.id = c.id OR wc.parent_id = c.id)
           AND w.status = 'published') AS "publishedInTree",
       (SELECT count(*)::int FROM product_categories s
         WHERE s.parent_id = c.id) AS subcategories,
       coalesce(parent.sort_order, c.sort_order) AS top_sort,
       coalesce(parent.slug, c.slug) AS top_slug
FROM product_categories c
LEFT JOIN product_categories parent ON parent.id = c.parent_id
LEFT JOIN category_translations tb ON tb.category_id = c.id AND tb.locale = 'bg'
LEFT JOIN category_translations te ON te.category_id = c.id AND te.locale = 'en'`;

type CategoryRow = Omit<AdminCategory, "products"> & {
  published: number;
  other: number;
  publishedInTree: number;
};

const toCategory = ({
  published,
  other,
  publishedInTree,
  ...row
}: CategoryRow & { top_sort?: number; top_slug?: string }): AdminCategory => {
  const { top_sort: _sort, top_slug: _slug, ...rest } = row;
  return { ...rest, products: { published, other, publishedInTree } };
};

/**
 * All categories, parents first, each followed by its subcategories, in
 * storefront order. Rows deeper than two levels (legacy data) are listed
 * too, so an admin can move them.
 */
export async function listAdminCategories(
  db: Pick<pg.Pool, "query">,
): Promise<AdminCategory[]> {
  const result = await db.query<CategoryRow>(
    `${CATEGORY_SQL}
     ORDER BY top_sort, top_slug, c.parent_id NULLS FIRST, c.sort_order, c.slug`,
  );
  return result.rows.map(toCategory);
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
  id: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
     VALUES($1,$2,$3,'category',$4,$5)`,
    [randomUUID(), actorId, action, id, JSON.stringify(details)],
  );
}

async function readCategory(client: Queryable, id: string) {
  const result = await client.query<CategoryRow>(
    `${CATEGORY_SQL} WHERE c.id = $1`,
    [id],
  );
  return result.rows[0] ? toCategory(result.rows[0]) : null;
}

/** A parent must exist and be top-level (the storefront has two levels). */
async function assertParent(
  client: Queryable,
  parentId: string | null,
  self: string | null,
) {
  if (!parentId) return;
  if (parentId === self)
    throw new AdminProductError("Категорията не може да е родител на себе си.");
  // FOR KEY SHARE: the parent cannot be moved under another category while
  // this change commits.
  const parent = await client.query<{ parent_id: string | null }>(
    "SELECT parent_id FROM product_categories WHERE id = $1 FOR KEY SHARE",
    [parentId],
  );
  if (!parent.rowCount)
    throw new AdminProductError("Непозната родителска категория.");
  if (parent.rows[0].parent_id)
    throw new AdminProductError(
      "Родителят трябва да е основна категория (без собствен родител).",
    );
}

async function writeNames(client: Queryable, id: string, input: CategoryInput) {
  await client.query(
    `INSERT INTO category_translations(category_id,locale,name)
     VALUES($1,'bg',$2)
     ON CONFLICT(category_id,locale) DO UPDATE SET name=EXCLUDED.name`,
    [id, input.name.bg],
  );
  if (input.name.en)
    await client.query(
      `INSERT INTO category_translations(category_id,locale,name)
       VALUES($1,'en',$2)
       ON CONFLICT(category_id,locale) DO UPDATE SET name=EXCLUDED.name`,
      [id, input.name.en],
    );
  else
    await client.query(
      "DELETE FROM category_translations WHERE category_id=$1 AND locale='en'",
      [id],
    );
}

export async function createCategory(
  pool: Pool,
  actorId: string,
  slug: string,
  input: CategoryInput,
): Promise<AdminCategory> {
  return transaction(pool, async (client) => {
    await assertParent(client, input.parentId, null);
    const id = randomUUID();
    const inserted = await client.query(
      `INSERT INTO product_categories(id,slug,parent_id,sort_order,active)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(slug) DO NOTHING RETURNING id`,
      [id, slug, input.parentId, input.sortOrder, input.active],
    );
    if (!inserted.rowCount)
      throw new AdminProductError(
        "Категория с този адрес вече съществува.",
        409,
      );
    await writeNames(client, id, input);
    await audit(client, actorId, "category.create", id, { slug, input });
    return (await readCategory(client, id))!;
  });
}

export async function updateCategory(
  pool: Pool,
  actorId: string,
  id: string,
  version: number,
  input: CategoryInput,
): Promise<AdminCategory> {
  return transaction(pool, async (client) => {
    // Lock the category and its new parent together, in id order, so two
    // admins moving categories under each other wait instead of deadlocking.
    const locked = await client.query<{ id: string }>(
      `SELECT id FROM product_categories WHERE id = ANY($1::uuid[])
       ORDER BY id FOR UPDATE`,
      [input.parentId ? [id, input.parentId] : [id]],
    );
    if (!locked.rows.some((row) => row.id === id))
      throw new AdminProductError("Категорията не е намерена.", 404);
    const before = (await readCategory(client, id))!;
    if (before.version !== version)
      throw new AdminProductError(
        "Категорията беше променена междувременно. Презареди и опитай отново.",
        409,
      );
    await assertParent(client, input.parentId, id);
    if (input.parentId && before.subcategories > 0)
      throw new AdminProductError(
        "Категория с подкатегории остава основна. Премести първо подкатегориите.",
      );
    const after = {
      name: { bg: input.name.bg, en: input.name.en },
      parentId: input.parentId,
      sortOrder: input.sortOrder,
      active: input.active,
    };
    const previous = {
      name: { bg: before.name, en: before.nameEn },
      parentId: before.parentId,
      sortOrder: before.sortOrder,
      active: before.active,
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(after) as (keyof typeof after)[])
      if (JSON.stringify(previous[key]) !== JSON.stringify(after[key]))
        changes[key] = { from: previous[key], to: after[key] };
    if (!Object.keys(changes).length) return before;
    await client.query(
      `UPDATE product_categories SET parent_id=$2, sort_order=$3, active=$4,
         content_version = content_version + 1, content_updated_at = now()
       WHERE id=$1`,
      [id, input.parentId, input.sortOrder, input.active],
    );
    await writeNames(client, id, input);
    await audit(client, actorId, "category.update", id, { changes });
    return (await readCategory(client, id))!;
  });
}
