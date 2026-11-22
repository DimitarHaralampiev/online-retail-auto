// Legal pages (#45): terms, privacy, delivery, returns and cookies. The texts
// are supplied by the business (admins edit them at /admin/legal); the shop
// never writes legal content itself. Trader details come from configuration
// and only configured fields are shown.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { AdminProductError } from "./admin-products";
import type { Locale } from "./i18n/locale";
import type { LegalSlug } from "./legal-shared";

export {
  companyDetails,
  isLegalSlug,
  LEGAL_SLUGS,
  LEGAL_TITLES,
  type CompanyDetails,
  type LegalSlug,
} from "./legal-shared";

export type LegalPage = {
  slug: LegalSlug;
  contentBg: string;
  contentEn: string;
  version: number;
  updatedAt: string | null;
};

export async function getLegalPage(
  db: Pick<pg.Pool, "query">,
  slug: LegalSlug,
): Promise<LegalPage> {
  const result = await db.query<{
    content_bg: string;
    content_en: string;
    version: number;
    updated_at: Date;
  }>(
    "SELECT content_bg, content_en, version, updated_at FROM legal_pages WHERE slug = $1",
    [slug],
  );
  const row = result.rows[0];
  return {
    slug,
    contentBg: row?.content_bg ?? "",
    contentEn: row?.content_en ?? "",
    version: row?.version ?? 0,
    updatedAt: row ? row.updated_at.toISOString() : null,
  };
}

/** Text to show in `locale`, with whether it is the Bulgarian fallback. */
export function legalText(
  page: Pick<LegalPage, "contentBg" | "contentEn">,
  locale: Locale,
): { text: string; fallback: boolean } {
  if (locale === "en" && page.contentEn.trim())
    return { text: page.contentEn, fallback: false };
  return {
    text: page.contentBg,
    fallback: locale === "en" && !!page.contentBg.trim(),
  };
}

export const legalUpdateSchema = z
  .object({
    version: z.number().int().min(0),
    contentBg: z.string().max(100_000, "Текстът е до 100 000 знака."),
    contentEn: z.string().max(100_000, "Текстът е до 100 000 знака."),
  })
  .strict();

/** Saves a page edited on `version` (0 = never saved); audited. */
export async function saveLegalPage(
  pool: Pick<pg.Pool, "connect">,
  actorId: string,
  slug: LegalSlug,
  input: z.infer<typeof legalUpdateSchema>,
): Promise<LegalPage> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The row may not exist yet: create it so it can be locked.
    await client.query(
      "INSERT INTO legal_pages(slug, version) VALUES ($1, 0) ON CONFLICT DO NOTHING",
      [slug],
    );
    const current = await client.query<{
      version: number;
      content_bg: string;
      content_en: string;
    }>(
      "SELECT version, content_bg, content_en FROM legal_pages WHERE slug = $1 FOR UPDATE",
      [slug],
    );
    const before = current.rows[0];
    if (before.version !== input.version)
      throw new AdminProductError(
        "Текстът беше променен междувременно. Презареди и опитай отново.",
        409,
      );
    const contentBg = input.contentBg.replace(/\r\n?/g, "\n").trim();
    const contentEn = input.contentEn.replace(/\r\n?/g, "\n").trim();
    if (contentBg.includes("\u0000") || contentEn.includes("\u0000"))
      throw new AdminProductError("Текстът съдържа недопустими знаци.");
    if (contentBg !== before.content_bg || contentEn !== before.content_en) {
      await client.query(
        `UPDATE legal_pages SET content_bg = $2, content_en = $3,
           version = version + 1, updated_by = $4, updated_at = now()
         WHERE slug = $1`,
        [slug, contentBg, contentEn, actorId],
      );
      await client.query(
        `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
         VALUES ($1,$2,'legal.update','legal_page',$3,$4)`,
        [
          randomUUID(),
          actorId,
          slug,
          JSON.stringify({
            bg: { from: before.content_bg.length, to: contentBg.length },
            en: { from: before.content_en.length, to: contentEn.length },
          }),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return getLegalPage(pool as unknown as Pick<pg.Pool, "query">, slug);
}
