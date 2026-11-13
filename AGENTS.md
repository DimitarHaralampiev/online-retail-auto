# Repository Guidelines

## Project Overview

`online-retail-auto` is a bilingual (Bulgarian/English) online shop for car accessories and parts in Bulgaria with its own warehouse. Stack: Next.js 16 App Router, React 19, TypeScript (strict), PostgreSQL 17 (`pg`), Zod validation, Stripe (test mode) and Nodemailer. Optional integrations: OpenAI (invoice reading and business insights; paid usage, server-only keys) and the Speedy courier API. The storefront catalog is still demo data in `src/lib/catalog.ts`; moving it to PostgreSQL is tracked in epic #12. The roadmap lives in GitHub epics #11–#17.

The `.agents/`, `.aws/`, `.codex/` and `.idea/` directories are local environment configuration; do not treat them as application modules or commit their contents.

## Project Structure

- `src/app/` — App Router pages (including `catalog`, `cart`, `checkout`, `account`, `orders`, `garage`, `favorites`, `for-you`, `promotions`, `inventory-demo`, `admin/*`) and route handlers under `src/app/api/`.
- `src/components/` — React components; client components carry `"use client"`.
- `src/lib/` — domain logic, data access and validation (catalog, pricing, inventory, checkout, orders, accounts, invoices, delivery). Unit tests sit next to the code as `*.test.ts`.
- `src/lib/i18n/` — locale handling and English translations (`en.json`); Bulgarian is the source language: write UI strings in Bulgarian and add the English entry to `en.json`, keyed by the whitespace-normalised Bulgarian text.
- `db/` — numbered SQL migrations (`NNN-name.sql`). `scripts/migrate.mjs` has no tracking table and re-applies every file in order, each in its own transaction, on every run, so each migration must be idempotent (`IF NOT EXISTS`, `ON CONFLICT`, guarded `ALTER`s) and must stay safe to re-run. Schema reference: `docs/database-schema.md`.
- `scripts/` — operational scripts (migrations, admin grant, workers, DB-backed flow tests).
- `docs/` — integration notes, reference reviews and screenshots. `public/images/` — product and design images.

## Toolchain and Commands

Node.js 22 LTS (`.nvmrc`; minimum 20.18.1 per `engines`) and npm. Install with `npm ci`.

- `npm run dev` — development server on http://localhost:3000.
- `npm run format:check` / `npm run format` — Prettier.
- `npm run typecheck` — TypeScript without emit.
- `npm test` — unit tests with the Node.js test runner via `tsx`. The glob is not recursive: only top-level `src/lib/*.test.ts` files run.
- `npm run build` / `npm start` — production build and server.
- Local services: copy `.env.example` to `.env.local`, then run `LOCAL_DB_PASSWORD=<password> docker compose up -d` (Postgres on 127.0.0.1:5433, Mailpit SMTP 1025 and UI http://localhost:8025). The password must match the one in `DATABASE_URL`; compose does not read `.env.local`.
- `npm run db:migrate` — apply all migrations using `.env.local`.
- `npm run admin:grant` — grant the admin role to an existing account.
- `npm run orders:send-emails`, `npm run customers:worker -- --watch` — order email queue and customer notification workers.
- `npm run mail:check` — verify SMTP settings.
- `npm run test:orders`, `npm run test:features` — end-to-end smoke flows. They need a running local app (`npm run dev`, or set `TEST_APP_URL`), a migrated local database, Mailpit and `PAYMENT_PROVIDER=simulator`, and refuse non-local targets.

Run format check, typecheck, unit tests and build before opening a pull request. Linting (#20) and CI (#21) are being added.

## Coding Style & Naming Conventions

Follow the existing patterns: TypeScript everywhere, Zod schemas for external input in new code, money as integer cents (`*_cents`) and rates as basis points (`*_bps`). Keep server-only secrets out of client components and never prefix them with `NEXT_PUBLIC_`. Use descriptive names and small modules; avoid unrelated formatting changes.

## Testing Guidelines

Add tests alongside new behavior in `src/lib/*.test.ts` using `node:test` and `node:assert`. Cover normal behavior, edge cases and failure paths; add a regression test for bug fixes. Do not claim checks passed without running them, and state explicitly in PRs when a check could not run.

## Commit & Pull Request Guidelines

Do not commit directly to `main`; merge through pull requests. Work on one branch per issue — `feature/<issue>-<slug>`, `fix/<issue>-<slug>` or `chore/<issue>-<slug>`. Use concise, imperative commit messages, for example `Add inventory import workflow`. Pull requests link their issue (`Closes #N`), describe the problem, resulting behavior and validation, and include screenshots for visible UI changes.

## Security & Configuration

Never commit credentials, tokens, customer data or local environment files (`.env*` except `.env.example`). Add placeholder values to `.env.example` and document required settings. Every API route authorizes on the server: customer and order data are scoped to the session's customer, never to a client-supplied ID; admin routes check the admin role; keep the origin check on state-changing routes; verify Stripe webhooks with `constructEvent`. Keep `ORDER_TRACKING_SECRET` and API keys server-only. Do not invent legal text, ratings, vehicle fitment or commercial claims.
