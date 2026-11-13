// Loads the demo catalog into PostgreSQL: categories with translations,
// published products with translations, initial stock and the demo
// promotion. Idempotent: re-running refreshes demo content but never resets
// stock (which real movements may have changed) and never touches products
// that are not marked as demo.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Product } from "./catalog";
import {
  demoCategories,
  demoCategorySlugs,
  demoProducts,
} from "./catalog-demo-data";
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

async function upsertCategory(
  client: Queryable,
  slug: string,
  name: string,
  parentId: string | null,
  sortOrder: number,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO product_categories(id,slug,parent_id,sort_order,active)
     VALUES($1,$2,$3,$4,true)
     ON CONFLICT(slug) DO UPDATE SET parent_id=EXCLUDED.parent_id,
       sort_order=EXCLUDED.sort_order, active=true
     RETURNING id`,
    [randomUUID(), slug, parentId, sortOrder],
  );
  const id = result.rows[0].id;
  for (const [locale, text] of [
    ["bg", name],
    ["en", translate(name, "en")],
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
  const result = await client.query<{ inserted: boolean }>(
    `INSERT INTO warehouse_products(sku,name,brand,manufacturer_code,ean,
       on_hand,reserved,category_id,status,selling_price_cents,image_path,is_demo)
     VALUES($1,$2,'DEMO',$1,'',$3,$4,$5,'published',$6,$7,true)
     ON CONFLICT(sku) DO UPDATE SET name=EXCLUDED.name,
       category_id=EXCLUDED.category_id, status='published',
       selling_price_cents=EXCLUDED.selling_price_cents,
       image_path=EXCLUDED.image_path, updated_at=now()
     WHERE warehouse_products.is_demo
     RETURNING (xmax = 0) AS inserted`,
    [
      product.sku,
      product.name,
      product.stock.onHand,
      product.stock.reserved,
      categoryId,
      product.demoPriceCents,
      product.image,
    ],
  );
  if (!result.rowCount)
    throw new Error(
      `SKU ${product.sku} belongs to a real product; the demo seed will not change it.`,
    );
  const inserted = result.rows[0].inserted;
  if (inserted && product.stock.onHand > 0)
    await client.query(
      `INSERT INTO stock_movements(id,sku,kind,quantity,reference_key,note)
       VALUES($1,$2,'receipt',$3,$4,'Demo catalog seed')
       ON CONFLICT(reference_key) DO NOTHING`,
      [
        randomUUID(),
        product.sku,
        product.stock.onHand,
        `demo-seed:${product.sku}`,
      ],
    );
  for (const locale of ["bg", "en"] as const)
    await client.query(
      `INSERT INTO product_translations(sku,locale,name,description)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(sku,locale) DO UPDATE SET name=EXCLUDED.name,
         description=EXCLUDED.description, updated_at=now()`,
      [
        product.sku,
        locale,
        translate(product.name, locale),
        translate(product.description, locale),
      ],
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
    const categoryIds = new Map<string, string>();
    for (const [index, name] of demoCategories.entries()) {
      categoryIds.set(
        name,
        await upsertCategory(
          client,
          demoCategorySlugs[name],
          name,
          null,
          index,
        ),
      );
      summary.categories += 1;
    }
    const subcategoryIds = new Map<string, string>();
    for (const product of products) {
      const parentId = categoryIds.get(product.category);
      if (!parentId)
        throw new Error(`Unknown demo category ${product.category}`);
      let categoryId = parentId;
      if (product.subcategory) {
        const { id, name } = product.subcategory;
        if (!subcategoryIds.has(id)) {
          subcategoryIds.set(
            id,
            await upsertCategory(
              client,
              id,
              name,
              parentId,
              subcategoryIds.size,
            ),
          );
          summary.categories += 1;
        }
        categoryId = subcategoryIds.get(id)!;
      }
      if (await upsertProduct(client, product, categoryId))
        summary.insertedProducts += 1;
      summary.products += 1;
    }
    await client.query(
      `INSERT INTO promotions(id,name,status) VALUES($1,'Демо промоции','active')
       ON CONFLICT(id) DO UPDATE SET status='active'`,
      [DEMO_PROMOTION_ID],
    );
    for (const product of products) {
      if (product.demoSalePriceCents === undefined) {
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
          product.demoPriceCents,
          product.demoSalePriceCents,
        ],
      );
      summary.promotionLines += 1;
    }
    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
