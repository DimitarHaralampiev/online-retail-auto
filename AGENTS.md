# Repository Guidelines

## Project Overview

`online-retail-auto` is a bilingual (Bulgarian/English) online shop for car accessories and parts in Bulgaria with its own warehouse. Stack: Next.js 16 App Router, React 19, TypeScript (strict), PostgreSQL 17 (`pg`), Zod validation, Stripe (test mode) and Nodemailer. Optional integrations: OpenAI (invoice reading and business insights; paid usage, server-only keys) and the Speedy courier API. The storefront catalog is served through a `CatalogRepository` backed by demo data (`src/lib/catalog-demo-data.ts`); the PostgreSQL adapter is tracked in epic #12. The roadmap lives in GitHub epics #11–#17.

The `.agents/`, `.aws/`, `.codex/` and `.idea/` directories are local environment configuration; do not treat them as application modules or commit their contents.

## Project Structure

- `src/app/` — App Router pages (including `catalog`, `cart`, `checkout`, `account`, `orders`, `garage`, `favorites`, `for-you`, `promotions`, `inventory-demo`, `admin/*`) and route handlers under `src/app/api/`.
- `src/components/` — React components; client components carry `"use client"`.
- `src/lib/` — domain logic, data access and validation (catalog, pricing, inventory, checkout, orders, accounts, invoices, delivery). Unit tests sit next to the code as `*.test.ts`.
- Catalog access: server code calls `catalog()` from `src/lib/catalog-server.ts` (a `CatalogRepository`); client components use `useCatalog()` from `src/components/catalog-provider.tsx`. Never import `catalog-demo-data` outside the static adapter wiring, tests and scripts (ESLint enforces this). See `docs/architecture/`.
- `src/lib/i18n/` — locale handling and English translations (`en.json`); Bulgarian is the source language: write UI strings in Bulgarian and add the English entry to `en.json`, keyed by the whitespace-normalised Bulgarian text.
- `db/` — numbered SQL migrations (`NNN-name.sql`). `scripts/migrate.mjs` has no tracking table and re-applies every file in order, each in its own transaction, on every run, so each migration must be idempotent (`IF NOT EXISTS`, `ON CONFLICT`, guarded `ALTER`s) and must stay safe to re-run. Schema reference: `docs/database-schema.md`.
- `scripts/` — operational scripts (migrations, admin grant, workers, DB-backed flow tests).
- `docs/` — integration notes, reference reviews and screenshots. `public/images/` — product and design images.

## Toolchain and Commands

Node.js 22 LTS (`.nvmrc`; minimum 20.18.1 per `engines`) and npm. Install with `npm ci`.

- `npm run dev` — development server on http://localhost:3000.
- `npm run format:check` / `npm run format` — Prettier.
- `npm run lint` — ESLint (Next.js core-web-vitals + TypeScript rules, `eslint.config.mjs`). Errors fail, and `--max-warnings 16` caps the existing warnings (legacy React findings tracked in #59), so new warnings fail too; lower the cap as they are fixed.
- `npm run typecheck` — TypeScript without emit.
- `npm test` — unit tests with the Node.js test runner via `tsx`. The glob is not recursive: only top-level `src/lib/*.test.ts` files run.
- `npm run test:integration` — PostgreSQL integration tests in `tests/integration/`. Each test file gets its own freshly migrated database (migrations applied twice to prove idempotency) that is dropped afterwards. Uses `TEST_DATABASE_URL`, or locally the server from `DATABASE_URL` in `.env.local`; non-local hosts and `host`/`hostaddr` query overrides are refused; databases left by killed runs are swept automatically. Use `setupTestDatabase()` from `tests/integration/database.ts` for new database tests.
- `npm run test:e2e` — Playwright browser tests in `e2e/` (desktop and mobile Chromium): shopping journeys up to the checkout preview plus an axe WCAG 2.1 AA scan that fails on serious or critical violations. It builds and starts the app on port 3100 with offline demo courier data and no database (set `E2E_BASE_URL` to test a running app). `npm run test:e2e:docker` runs the same suite in the official Playwright image when the host lacks browser libraries (e.g. WSL); it reuses the host `node_modules` (Linux x64 only) and the shared `.next`, so stop other builds first. Locally a server already on port 3100 is reused. Prefer role and label locators.
- `npm run build` / `npm start` — production build and server.
- Local services: copy `.env.example` to `.env.local`, then run `LOCAL_DB_PASSWORD=<password> docker compose up -d` (Postgres on 127.0.0.1:5433, Mailpit SMTP 1025 and UI http://localhost:8025). The password must match the one in `DATABASE_URL`; compose does not read `.env.local`.
- `npm run db:migrate` — apply all migrations using `.env.local`.
- Catalog source: `CATALOG_SOURCE=postgres` serves the catalog from PostgreSQL (seed it first); unset or `static` uses the built-in demo data, as builds and browser tests do.
- `npm run db:seed:demo` — load the demo catalog (categories, translations, published products, stock, demo promotion) into the database. Idempotent; never resets stock or touches non-demo products; refuses a non-local `APP_URL` unless `ALLOW_DEMO_SEED=1`. Migrations never contain catalog data.
- `npm run admin:grant -- <email>` — grant the admin role to an existing account with a verified email.
- Admin product management lives at `/admin/products` (list, create/edit at `/admin/products/edit`, media at `/admin/products/media`, categories at `/admin/categories`) on the `/api/admin/catalog/products` and `/api/admin/catalog/categories` routes. Category slugs are storefront URL ids and fixed at creation; categories are deactivated, never deleted, and stay at most two levels deep. Re-running the demo seed resets demo categories' parent, order and names (not their active flag) and does not check the two-level rule, so on demo data avoid nesting real categories under demo ones. Moving a category changes its storefront URL; old links are not redirected. New products start as drafts without stock; publishing requires a price and an active category. It needs `CATALOG_SOURCE=postgres` for changes to reach the storefront. Invoice receipts match an existing SKU by brand, manufacturer code and EAN (case-insensitive): empty fields count as unknown and are filled from the invoice, but a product with any known field needs at least one match.
- Bulk product import: `/admin/products/import` (API `/api/admin/catalog/imports`, logic in `src/lib/product-import.ts`). Upload a UTF-8 CSV (`;` or `,`, up to 2 MB and 2000 rows; split larger catalogs) with the columns listed on the page; a check (dry run) reports every row, and apply commits only when no row has an error. Empty cells keep existing values; `stock` books opening stock for new products only.
- `npm run orders:release-expired` (`-- --watch` to run every minute) — release stock held by unpaid card orders whose payment window passed, cancel them and email the customer. Production must run it continuously or from cron, otherwise unpaid card orders hold stock indefinitely. With `CATALOG_SOURCE=postgres`, orders reserve stock in the order transaction (`src/lib/stock-reservations.ts`); handover consumes and cancellation releases it.
- `npm run orders:send-emails`, `npm run customers:worker -- --watch` — order email queue and customer notification workers.
- `npm run mail:check` — verify SMTP settings.
- `npm run test:orders`, `npm run test:features` — end-to-end smoke flows. They need a running local app (`npm run dev`, or set `TEST_APP_URL`), a migrated local database, and Mailpit (`test:orders` also needs `PAYMENT_PROVIDER=simulator`), and refuse non-local targets.

Run format check, lint, typecheck, unit tests and build before opening a pull request. GitHub Actions (`.github/workflows/ci.yml`) runs the production dependency audit and these checks on every pull request and on `main`; Dependabot proposes weekly grouped dependency updates.

## Coding Style & Naming Conventions

Follow the existing patterns: TypeScript everywhere, Zod schemas for external input in new code, money as integer cents (`*_cents`) and rates as basis points (`*_bps`). Keep server-only secrets out of client components and never prefix them with `NEXT_PUBLIC_`. Use descriptive names and small modules; avoid unrelated formatting changes.

## Testing Guidelines

Add tests alongside new behavior in `src/lib/*.test.ts` using `node:test` and `node:assert`. Cover normal behavior, edge cases and failure paths; add a regression test for bug fixes. Do not claim checks passed without running them, and state explicitly in PRs when a check could not run.

## Commit & Pull Request Guidelines

Do not commit directly to `main`; merge through pull requests. Work on one branch per issue — `feature/<issue>-<slug>`, `fix/<issue>-<slug>` or `chore/<issue>-<slug>`. Use concise, imperative commit messages, for example `Add inventory import workflow`. Pull requests link their issue (`Closes #N`), describe the problem, resulting behavior and validation, and include screenshots for visible UI changes.

## Security & Configuration

Never commit credentials, tokens, customer data or local environment files (`.env*` except `.env.example`). Add placeholder values to `.env.example` and document required settings. Every API route authorizes on the server: customer and order data are scoped to the session's customer, never to a client-supplied ID; admin routes check the admin role; keep the origin check on state-changing routes; verify Stripe webhooks with `constructEvent`. Keep `ORDER_TRACKING_SECRET` and API keys server-only. Do not invent legal text, ratings, vehicle fitment or commercial claims.
