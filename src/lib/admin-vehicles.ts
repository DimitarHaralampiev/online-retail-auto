// Vehicle reference for administrators (ADR 0002, #91): overview, manual
// add and edit, and hiding at every level. Larger amounts go through the CSV
// import (vehicle-import.ts). Data comes only from a verified source; nothing
// is deleted. Callers authorize first.
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { AdminProductError } from "./admin-products";
import { assertFitmentYears, slugify } from "./vehicle-reference";
import { FUELS, type Fuel } from "./vehicles";

export type ReferenceModel = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  version: number;
  generations: number;
  engines: number;
  fitments: number;
};
export type ReferenceMake = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  version: number;
  models: ReferenceModel[];
};

/** Every make with its models and counts, active or not, by name. */
export async function referenceTree(
  db: Pick<pg.Pool, "query">,
): Promise<ReferenceMake[]> {
  const makes = await db.query<Omit<ReferenceMake, "models">>(
    `SELECT id, name, slug, active, version FROM vehicle_makes
     ORDER BY name COLLATE "und-x-icu", slug`,
  );
  const models = await db.query<ReferenceModel & { make_id: string }>(
    `SELECT m.id, m.make_id, m.name, m.slug, m.active, m.version,
            (SELECT count(*)::int FROM vehicle_generations g WHERE g.model_id = m.id) AS generations,
            (SELECT count(*)::int FROM vehicle_engines e
               JOIN vehicle_generations g ON g.id = e.generation_id
              WHERE g.model_id = m.id) AS engines,
            (SELECT count(*)::int FROM product_vehicle_fitments f
               JOIN vehicle_generations g ON g.id = f.generation_id
              WHERE g.model_id = m.id) AS fitments
     FROM vehicle_models m
     ORDER BY m.name COLLATE "und-x-icu", m.slug`,
  );
  return makes.rows.map((make) => ({
    ...make,
    models: models.rows
      .filter((model) => model.make_id === make.id)
      .map(({ make_id: _make, ...model }) => model),
  }));
}

export const visibilitySchema = z.object({ active: z.boolean() });

/** Shows or hides one entry (and everything below it). */
export async function setReferenceActive(
  db: Pick<pg.Pool, "connect">,
  actorId: string,
  kind: ReferenceKind,
  id: string,
  active: boolean,
): Promise<void> {
  const { table, missing } = KINDS[kind];
  await transaction(db, async (client) => {
    const changed = await client.query<{ was: boolean }>(
      `UPDATE ${table} t SET active = $2 FROM ${table} old
       WHERE t.id = $1 AND old.id = t.id RETURNING old.active AS was`,
      [id, active],
    );
    if (!changed.rowCount) throw new AdminProductError(missing, 404);
    if (changed.rows[0].was !== active)
      await audit(client, actorId, "vehicle.visibility", kind, id, {
        active: { from: !active, to: active },
      });
  });
}

const text = (label: string, max = 100) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .max(max, `${label} е до ${max} знака.`)
        .refine(
          (value) => !/[\u0000-\u001f]/.test(value),
          "Текстът съдържа недопустими знаци.",
        ),
    );
const name = text("Името").refine((value) => value !== "", "Въведи име.");
const slugSchema = z
  .string()
  .trim()
  .max(60, "Адресът е до 60 знака.")
  .regex(
    /^([a-z0-9]+(-[a-z0-9]+)*)?$/,
    "Адресът трябва да е от малки латински букви, цифри и тирета.",
  )
  .default("");
const year = z
  .number("Въведи година.")
  .int("Годината е цяло число.")
  .min(1950, "Годината е от 1950 до 2100.")
  .max(2100, "Годината е от 1950 до 2100.");
const whole = (label: string, max: number) =>
  z
    .number()
    .int(`${label} е цяло число.`)
    .min(1, `${label} е от 1 до ${max}.`)
    .max(max, `${label} е от 1 до ${max}.`)
    .nullable()
    .default(null);

/** Fields an admin edits, per kind. Slugs are URL ids: fixed at creation. */
export const referenceSchemas = {
  make: z.object({ name }),
  model: z.object({ name }),
  generation: z
    .object({ name, yearFrom: year, yearTo: year.nullable().default(null) })
    .refine((g) => g.yearTo === null || g.yearTo >= g.yearFrom, {
      message: "Крайната година е преди началната.",
      path: ["yearTo"],
    }),
  engine: z.object({
    name,
    fuel: z.enum(FUELS, "Избери гориво."),
    displacementCc: whole("Обемът", 20000),
    powerKw: whole("Мощността", 2000),
    engineCode: text("Кодът на двигателя", 60).default(""),
  }),
};
export type ReferenceKind = keyof typeof referenceSchemas;
export const isReferenceKind = (kind: string): kind is ReferenceKind =>
  Object.hasOwn(referenceSchemas, kind);

const parentSchema = z.object({ parentId: z.uuid("Невалиден родител.") });
export const createReferenceSchemas = {
  make: referenceSchemas.make.extend({ slug: slugSchema }),
  model: referenceSchemas.model
    .extend({ slug: slugSchema })
    .extend(parentSchema.shape),
  generation: z.intersection(referenceSchemas.generation, parentSchema),
  engine: referenceSchemas.engine.extend(parentSchema.shape),
};

type Fields = {
  name: string;
  slug?: string;
  parentId?: string;
  yearFrom?: number;
  yearTo?: number | null;
  fuel?: Fuel;
  displacementCc?: number | null;
  powerKw?: number | null;
  engineCode?: string;
};

// Columns are fixed per kind; only values come from the request.
const KINDS: Record<
  ReferenceKind,
  {
    table: string;
    missing: string;
    duplicate: string;
    parent?: { table: string; column: string; missing: string };
    columns: [column: string, field: keyof Fields][];
  }
> = {
  make: {
    table: "vehicle_makes",
    missing: "Марката не е намерена.",
    duplicate: "Вече има марка с този адрес.",
    columns: [["name", "name"]],
  },
  model: {
    table: "vehicle_models",
    missing: "Моделът не е намерен.",
    duplicate: "Марката вече има модел с този адрес.",
    parent: {
      table: "vehicle_makes",
      column: "make_id",
      missing: "Марката не е намерена.",
    },
    columns: [["name", "name"]],
  },
  generation: {
    table: "vehicle_generations",
    missing: "Поколението не е намерено.",
    duplicate: "Моделът вече има поколение с това име.",
    parent: {
      table: "vehicle_models",
      column: "model_id",
      missing: "Моделът не е намерен.",
    },
    columns: [
      ["name", "name"],
      ["year_from", "yearFrom"],
      ["year_to", "yearTo"],
    ],
  },
  engine: {
    table: "vehicle_engines",
    missing: "Двигателят не е намерен.",
    duplicate: "Поколението вече има двигател с това име.",
    parent: {
      table: "vehicle_generations",
      column: "generation_id",
      missing: "Поколението не е намерено.",
    },
    columns: [
      ["name", "name"],
      ["fuel", "fuel"],
      ["displacement_cc", "displacementCc"],
      ["power_kw", "powerKw"],
      ["engine_code", "engineCode"],
    ],
  },
};

async function transaction<T>(
  db: Pick<pg.Pool, "connect">,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
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
  client: pg.PoolClient,
  actorId: string,
  action: string,
  kind: ReferenceKind,
  id: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO admin_audit_log(id,actor_id,action,entity_type,entity_id,details)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      randomUUID(),
      actorId,
      action,
      `vehicle_${kind}`,
      id,
      JSON.stringify(details),
    ],
  );
}

const duplicate = (error: unknown, kind: ReferenceKind): never => {
  if ((error as { code?: string }).code === "23505")
    throw new AdminProductError(KINDS[kind].duplicate, 409);
  throw error;
};

/** Adds an entry under its parent; returns its id. */
export async function createReference(
  db: Pick<pg.Pool, "connect">,
  actorId: string,
  kind: ReferenceKind,
  input: Fields,
): Promise<string> {
  const { table, parent, columns } = KINDS[kind];
  return transaction(db, async (client) => {
    const id = randomUUID();
    const values: [string, unknown][] = columns.map(([column, field]) => [
      column,
      input[field] ?? null,
    ]);
    if (parent) {
      const found = await client.query(
        `SELECT 1 FROM ${parent.table} WHERE id = $1 FOR SHARE`,
        [input.parentId],
      );
      if (!found.rowCount) throw new AdminProductError(parent.missing, 404);
      values.push([parent.column, input.parentId]);
    }
    if (kind === "make" || kind === "model") {
      const slug =
        input.slug || slugify(input.name).slice(0, 60).replace(/-+$/, "");
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
        throw new AdminProductError(
          "Задай адрес с латински букви (името няма латински знаци).",
        );
      values.push(["slug", slug]);
    }
    await client
      .query(
        `INSERT INTO ${table}(id, ${values.map(([column]) => column).join(", ")})
         VALUES($1, ${values.map((_, i) => `$${i + 2}`).join(", ")})`,
        [id, ...values.map(([, value]) => value)],
      )
      .catch((error) => duplicate(error, kind));
    await audit(client, actorId, "vehicle.create", kind, id, { input });
    return id;
  });
}

/** Saves an edit made on `version`; a newer version is never overwritten. */
export async function updateReference(
  db: Pick<pg.Pool, "connect">,
  actorId: string,
  kind: ReferenceKind,
  id: string,
  version: number,
  input: Fields,
): Promise<void> {
  const { table, missing, columns } = KINDS[kind];
  await transaction(db, async (client) => {
    const found = await client.query<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const before = found.rows[0];
    if (!before) throw new AdminProductError(missing, 404);
    if (before.version !== version)
      throw new AdminProductError(
        "Записът беше променен междувременно. Презареди и опитай отново.",
        409,
      );
    const changes = Object.fromEntries(
      columns
        .map(([column, field]) => [
          column,
          { from: before[column], to: input[field] ?? null },
        ])
        .filter(([, change]) => {
          const { from, to } = change as { from: unknown; to: unknown };
          return from !== to;
        }),
    );
    if (!Object.keys(changes).length) return;
    if (kind === "generation")
      await assertFitmentYears(
        client,
        id,
        input.yearFrom!,
        input.yearTo ?? null,
      );
    await client
      .query(
        `UPDATE ${table} SET ${columns.map(([column], i) => `${column} = $${i + 2}`).join(", ")},
           version = version + 1 WHERE id = $1`,
        [id, ...columns.map(([, field]) => input[field] ?? null)],
      )
      .catch((error) => duplicate(error, kind));
    await audit(client, actorId, "vehicle.update", kind, id, { changes });
  });
}

export type ReferenceEngine = {
  id: string;
  name: string;
  fuel: Fuel;
  displacementCc: number | null;
  powerKw: number | null;
  engineCode: string;
  active: boolean;
  version: number;
  fitments: number;
};
export type ReferenceGeneration = {
  id: string;
  name: string;
  yearFrom: number;
  yearTo: number | null;
  active: boolean;
  version: number;
  /** Fitments of the whole generation (without an engine). */
  fitments: number;
  engines: ReferenceEngine[];
};

/** One model with its generations and engines, hidden ones included. */
export async function referenceModel(
  db: Pick<pg.Pool, "query">,
  id: string,
): Promise<{
  id: string;
  make: string;
  name: string;
  generations: ReferenceGeneration[];
} | null> {
  const model = await db.query<{ id: string; make: string; name: string }>(
    `SELECT m.id, k.name AS make, m.name FROM vehicle_models m
     JOIN vehicle_makes k ON k.id = m.make_id WHERE m.id = $1`,
    [id],
  );
  if (!model.rows[0]) return null;
  const [generations, engines] = await Promise.all([
    db.query<Omit<ReferenceGeneration, "engines">>(
      `SELECT g.id, g.name, g.year_from AS "yearFrom", g.year_to AS "yearTo",
              g.active, g.version,
              (SELECT count(*)::int FROM product_vehicle_fitments f
               WHERE f.generation_id = g.id AND f.engine_id IS NULL) AS fitments
       FROM vehicle_generations g WHERE g.model_id = $1
       ORDER BY g.year_from, g.name`,
      [id],
    ),
    db.query<ReferenceEngine & { generation_id: string }>(
      `SELECT e.id, e.generation_id, e.name, e.fuel,
              e.displacement_cc AS "displacementCc", e.power_kw AS "powerKw",
              e.engine_code AS "engineCode", e.active, e.version,
              (SELECT count(*)::int FROM product_vehicle_fitments f
               WHERE f.engine_id = e.id) AS fitments
       FROM vehicle_engines e
       JOIN vehicle_generations g ON g.id = e.generation_id
       WHERE g.model_id = $1
       ORDER BY e.fuel, e.displacement_cc NULLS LAST, e.power_kw NULLS LAST, e.name`,
      [id],
    ),
  ]);
  return {
    ...model.rows[0],
    generations: generations.rows.map((generation) => ({
      ...generation,
      engines: engines.rows
        .filter((engine) => engine.generation_id === generation.id)
        .map(({ generation_id: _generation, ...engine }) => engine),
    })),
  };
}
