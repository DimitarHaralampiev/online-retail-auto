import { applyMigrations } from "./migrations.mjs";

if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL before running migrations.");
await applyMigrations(process.env.DATABASE_URL, { log: console.log });
