// Loads the demo catalog into PostgreSQL: categories with translations,
// published products with translations, initial stock and the demo
// promotion.
//
// Idempotent and conservative on re-runs: demo names, prices, images and
// translations are refreshed, but stock is never reset (real movements may
// have changed it), products and the promotion keep the status an admin gave
// them, and rows not created by the seed (is_demo = false) are never touched.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Product } from "./catalog";
import { demoCategories, demoProducts } from "./catalog-demo-data";
import { translate } from "./i18n/translate";

/** Fixed id, so re-seeding updates the same demo promotion. */
export const DEMO_PROMOTION_ID = "00000000-0000-4000-8000-00000000d0e0";

type Queryable = Pick<pg.PoolClient, "query">;

export type SeedSummary = {
  categories: number;
  products: number;
  insertedProducts: number;
  promotionLines: number;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Decides whether the seed may write to the database in DATABASE_URL.
 * Throws with an explanation unless the target is a local server outside
 * production, or ALLOW_DEMO_SEED=1 explicitly allows it.
 */
export type DemoSeedEnv = Partial<
  Record<"DATABASE_URL" | "NODE_ENV" | "ALLOW_DEMO_SEED", string>
>;

export function assertDemoSeedTarget(env: DemoSeedEnv): void {
  if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
  if (env.ALLOW_DEMO_SEED === "1") return;
  if (env.NODE_ENV === "production")
    throw new Error(
      "Refusing to load demo products with NODE_ENV=production. Set ALLOW_DEMO_SEED=1 to override.",
    );
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL is not a valid connection URL.");
  }
  // pg lets query parameters override the host, so they would bypass the check.
  for (const key of url.searchParams.keys())
    if (/^host(addr)?$/i.test(key))
      throw new Error(
        `DATABASE_URL overrides the host with "${key}". Set ALLOW_DEMO_SEED=1 to load demo products there.`,
      );
  if (!LOCAL_HOSTS.has(url.hostname))
    throw new Error(
      `DATABASE_URL points to ${url.hostname}${url.pathname}. Set ALLOW_DEMO_SEED=1 to load demo products there.`,
    );
}

/** English text from the dictionary; fails instead of storing Bulgarian. */
function english(text: string): string {
  const translated = translate(text, "en");
  if (/[А-Яа-я]/u.test(translated))
    throw new Error(`Missing English translation for "${text}" in en.json.`);
  return translated;
}

async function upsertCategory(
  client: Queryable,
  slug: string,
  name: string,
  parentId: string | null,
  sortOrder: number,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO product_categories(id,slug,parent_id,sort_order,active,is_demo)
     VALUES($1,$2,$3,$4,true,true)
     ON CONFLICT(slug) DO UPDATE SET parent_id=EXCLUDED.parent_id,
       sort_order=EXCLUDED.sort_order,
       content_version=product_categories.content_version +
         CASE WHEN (product_categories.parent_id, product_categories.sort_order)
           IS DISTINCT FROM (EXCLUDED.parent_id, EXCLUDED.sort_order)
         THEN 1 ELSE 0 END,
       content_updated_at=CASE WHEN (product_categories.parent_id, product_categories.sort_order)
           IS DISTINCT FROM (EXCLUDED.parent_id, EXCLUDED.sort_order)
         THEN now() ELSE product_categories.content_updated_at END
     WHERE product_categories.is_demo
     RETURNING id`,
    [randomUUID(), slug, parentId, sortOrder],
  );
  if (!result.rowCount)
    throw new Error(
      `Category slug ${slug} belongs to a real category; the demo seed will not change it.`,
    );
  const id = result.rows[0].id;
  for (const [locale, text] of [
    ["bg", name],
    ["en", english(name)],
  ])
    await client.query(
      `INSERT INTO category_translations(category_id,locale,name)
       VALUES($1,$2,$3)
       ON CONFLICT(category_id,locale) DO UPDATE SET name=EXCLUDED.name`,
      [id, locale, text],
    );
  return id;
}

async function upsertProduct(
  client: Queryable,
  product: Product,
  categoryId: string,
): Promise<boolean> {
  // Seeded stock is what the demo shows as available, with nothing reserved:
  // reservations only come from orders (stock_reservations), so the ledger
  // and `reserved` stay consistent.
  const available = Math.max(product.stock.onHand - product.stock.reserved, 0);
  // (xmax = 0) is true for a freshly inserted row and false for an updated
  // one; it only drives the summary and the one-off stock receipt, which is
  // idempotent through its reference key anyway.
  const result = await client.query<{ inserted: boolean }>(
    `INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,
       on_hand,reserved,category_id,status,selling_price_cents,image_path,is_demo)
     VALUES($1,$2,'DEMO',$1,'',$3,0,$4,'published',$5,$6,true)
     ON CONFLICT(sku) DO UPDATE SET name=EXCLUDED.name,
       category_id=EXCLUDED.category_id,
       selling_price_cents=EXCLUDED.selling_price_cents,
       image_path=EXCLUDED.image_path, updated_at=now(),
       content_version=warehouse_products.content_version + 1,
       content_updated_at=now()
     WHERE warehouse_products.is_demo
     RETURNING (xmax = 0) AS inserted`,
    [
      product.sku,
      product.name,
      available,
      categoryId,
      product.priceCents,
      product.image,
    ],
  );
  if (!result.rowCount)
    throw new Error(
      `SKU ${product.sku} belongs to a real product; the demo seed will not change it.`,
    );
  const inserted = result.rows[0].inserted;
  if (inserted && available > 0)
    await client.query(
      `INSERT INTO stock_movements(id,sku,kind,quantity,reference_key,note)
       VALUES($1,$2,'receipt',$3,$4,'Demo catalog seed')
       ON CONFLICT(reference_key) DO NOTHING`,
      [randomUUID(), product.sku, available, `demo-seed:${product.sku}`],
    );
  for (const [locale, name, description] of [
    ["bg", product.name, product.description],
    ["en", english(product.name), english(product.description)],
  ])
    await client.query(
      `INSERT INTO product_translations(sku,locale,name,description)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(sku,locale) DO UPDATE SET name=EXCLUDED.name,
         description=EXCLUDED.description, updated_at=now()`,
      [product.sku, locale, name, description],
    );
  return inserted;
}

/** Runs the whole seed in one transaction on the given client. */
export async function seedDemoCatalog(
  client: Queryable,
  products: readonly Product[] = demoProducts,
): Promise<SeedSummary> {
  const summary: SeedSummary = {
    categories: 0,
    products: 0,
    insertedProducts: 0,
    promotionLines: 0,
  };
  await client.query("BEGIN");
  try {
    // Serialise concurrent seeds explicitly instead of relying on row locks.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('demo-catalog-seed'))",
    );
    const categoryIds = new Map<string, string>();
    for (const [index, category] of demoCategories.entries()) {
      categoryIds.set(
        category.id,
        await upsertCategory(client, category.id, category.name, null, index),
      );
      summary.categories += 1;
    }
    const subcategoryIds = new Map<string, string>();
    const subcategoryCounts = new Map<string, number>();
    for (const product of products) {
      const parentId = categoryIds.get(product.category.id);
      if (!parentId)
        throw new Error(`Unknown demo category ${product.category.id}`);
      let categoryId = parentId;
      if (product.subcategory) {
        const { id, name } = product.subcategory;
        if (!subcategoryIds.has(id)) {
          const position = subcategoryCounts.get(parentId) ?? 0;
          subcategoryCounts.set(parentId, position + 1);
          subcategoryIds.set(
            id,
            await upsertCategory(client, id, name, parentId, position),
          );
          summary.categories += 1;
        }
        categoryId = subcategoryIds.get(id)!;
      }
      if (await upsertProduct(client, product, categoryId))
        summary.insertedProducts += 1;
      summary.products += 1;
    }
    // Created active once; an admin who ends it keeps it ended.
    await client.query(
      `INSERT INTO promotions(id,name,status) VALUES($1,'Демо промоции','active')
       ON CONFLICT(id) DO NOTHING`,
      [DEMO_PROMOTION_ID],
    );
    for (const product of products) {
      if (product.salePriceCents === undefined) {
        await client.query(
          "DELETE FROM promotion_lines WHERE promotion_id=$1 AND sku=$2",
          [DEMO_PROMOTION_ID, product.sku],
        );
        continue;
      }
      await client.query(
        `INSERT INTO promotion_lines(promotion_id,sku,regular_price_cents,sale_price_cents)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(promotion_id,sku) DO UPDATE SET
           regular_price_cents=EXCLUDED.regular_price_cents,
           sale_price_cents=EXCLUDED.sale_price_cents`,
        [
          DEMO_PROMOTION_ID,
          product.sku,
          product.priceCents,
          product.salePriceCents,
        ],
      );
      summary.promotionLines += 1;
    }
    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
