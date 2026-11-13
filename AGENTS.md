# Repository Guidelines

## Project Overview

`online-retail-auto` is a bilingual (Bulgarian/English) online shop for car accessories and parts in Bulgaria with its own warehouse. Stack: Next.js 16 App Router, React 19, TypeScript (strict), PostgreSQL 17 (`pg`), Zod validation, Stripe (test mode) and Nodemailer. The storefront catalog is still demo data in `src/lib/catalog.ts`; moving it to PostgreSQL is tracked in epic #12. The roadmap lives in GitHub epics #11–#17.

The `.agents/`, `.aws/`, `.codex/` and `.idea/` directories are local environment configuration; do not treat them as application modules or commit their contents.

## Project Structure

- `src/app/` — App Router pages (`catalog`, `cart`, `checkout`, `account`, `orders`, `garage`, `favorites`, `promotions`, `admin/*`) and route handlers under `src/app/api/`.
- `src/components/` — React components; client components carry `"use client"`.
- `src/lib/` — domain logic, data access and validation (catalog, pricing, inventory, checkout, orders, accounts, invoices, delivery). Unit tests sit next to the code as `*.test.ts`.
- `src/lib/i18n/` — locale handling and English translations (`en.json`); Bulgarian is the source language.
- `db/` — numbered, repeatable SQL migrations (`NNN-name.sql`), applied by `scripts/migrate.mjs`. Schema reference: `docs/database-schema.md`.
- `scripts/` — operational scripts (migrations, admin grant, workers, DB-backed flow tests).
- `docs/` — integration notes, reference reviews and screenshots. `public/images/` — product and design images.

## Toolchain and Commands

Node.js 22 LTS (`.nvmrc`; minimum 20.18.1 per `engines`) and npm. Install with `npm ci`.

- `npm run dev` — development server on http://localhost:3000.
- `npm run format:check` / `npm run format` — Prettier.
- `npm run typecheck` — TypeScript without emit.
- `npm test` — unit tests (`src/lib/*.test.ts`) with the Node.js test runner via `tsx`.
- `npm run build` / `npm start` — production build and server.
- `npm run db:migrate` — apply migrations using `.env.local` (start Postgres and Mailpit with `docker compose up -d`).
- `npm run test:orders`, `npm run test:features` — DB-backed flow checks; require a migrated local database.

Run format check, typecheck, unit tests and build before opening a pull request.

## Coding Style & Naming Conventions

Follow the existing patterns: TypeScript everywhere, Zod schemas for all external input, money as integer cents (`*_cents`) and rates as basis points (`*_bps`). Keep server-only secrets out of client components and never prefix them with `NEXT_PUBLIC_`. Use descriptive names and small modules; avoid unrelated formatting changes.

## Testing Guidelines

Add tests alongside new behavior in `src/lib/*.test.ts` using `node:test` and `node:assert`. Cover normal behavior, edge cases and failure paths; add a regression test for bug fixes. Do not claim checks passed without running them, and state explicitly in PRs when a check could not run.

## Commit & Pull Request Guidelines

`main` is protected by convention: work on one branch per issue — `feature/<issue>-<slug>`, `fix/<issue>-<slug>` or `chore/<issue>-<slug>`. Use concise, imperative commit messages, for example `Add inventory import workflow`. Pull requests link their issue (`Closes #N`), describe the problem, resulting behavior and validation, and include screenshots for visible UI changes.

## Security & Configuration

Never commit credentials, tokens, customer data or local environment files (`.env*` except `.env.example`). Add placeholder values to `.env.example` and document required settings. Verify authorization on the server for every admin route. Do not invent legal text, ratings, vehicle fitment or commercial claims.
