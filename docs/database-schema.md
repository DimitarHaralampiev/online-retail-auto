# Database Schema

Apply migrations with `npm run db:migrate`. Each SQL file runs in its own transaction and is repeatable. Monetary values ending in `_cents` use integer minor units; `_bps` values use basis points.

Accounts, verification, orders and notification queues retain their existing workflows. Warehouse receipts remain the active invoice stock ledger. Migrations 007–008 add schema foundations for suppliers, normalized lines, payments, shipments, promotions, replenishment and analytics. Creating these tables does not enable live payment collection, shipment labels, product publishing or automatic promotion execution. Analytics uses trusted aggregates and product full-text retrieval; product media uses the active `product_media` table from migration 009. `product_images` is reserved for a future object-storage adapter.

The inventory below contains schema metadata only, with no customer or business records.

## admin_audit_log

| Column      | Type                     | Nullable | Default     |
| ----------- | ------------------------ | -------- | ----------- |
| id          | uuid                     | NO       | —           |
| actor_id    | uuid                     | YES      | —           |
| action      | text                     | NO       | —           |
| entity_type | text                     | NO       | —           |
| entity_id   | text                     | NO       | —           |
| details     | jsonb                    | NO       | '{}'::jsonb |
| created_at  | timestamp with time zone | NO       | now()       |

Constraints:

- `FOREIGN KEY (actor_id) REFERENCES customers(id)`
- `PRIMARY KEY (id)`

## analytics_runs

| Column               | Type                     | Nullable | Default |
| -------------------- | ------------------------ | -------- | ------- |
| id                   | uuid                     | NO       | —       |
| actor_id             | uuid                     | YES      | —       |
| days                 | integer                  | NO       | —       |
| includes_test_orders | boolean                  | NO       | false   |
| snapshot             | jsonb                    | NO       | —       |
| created_at           | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (actor_id) REFERENCES customers(id) ON DELETE SET NULL`
- `CHECK (((days >= 1) AND (days <= 365)))`
- `PRIMARY KEY (id)`

## auth_attempts

| Column     | Type                     | Nullable | Default |
| ---------- | ------------------------ | -------- | ------- |
| key        | text                     | NO       | —       |
| attempts   | integer                  | NO       | —       |
| expires_at | timestamp with time zone | NO       | —       |

Constraints:

- `PRIMARY KEY (key)`

## business_recommendations

| Column                | Type                     | Nullable | Default          |
| --------------------- | ------------------------ | -------- | ---------------- |
| id                    | uuid                     | NO       | —                |
| run_id                | uuid                     | NO       | —                |
| sku                   | text                     | NO       | —                |
| kind                  | text                     | NO       | —                |
| status                | text                     | NO       | 'proposed'::text |
| title                 | text                     | NO       | —                |
| explanation           | text                     | NO       | —                |
| evidence              | jsonb                    | NO       | —                |
| suggested_quantity    | integer                  | YES      | —                |
| suggested_price_cents | integer                  | YES      | —                |
| target_type           | text                     | YES      | —                |
| target_id             | uuid                     | YES      | —                |
| decided_by            | uuid                     | YES      | —                |
| decided_at            | timestamp with time zone | YES      | —                |
| created_at            | timestamp with time zone | NO       | now()            |

Constraints:

- `FOREIGN KEY (decided_by) REFERENCES customers(id) ON DELETE SET NULL`
- `CHECK ((kind = ANY (ARRAY['reorder'::text, 'promotion'::text, 'price_review'::text, 'catalog_review'::text])))`
- `PRIMARY KEY (id)`
- `FOREIGN KEY (run_id) REFERENCES analytics_runs(id) ON DELETE CASCADE`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku)`
- `CHECK ((status = ANY (ARRAY['proposed'::text, 'accepted'::text, 'dismissed'::text, 'outdated'::text])))`
- `CHECK ((suggested_price_cents > 0))`
- `CHECK ((suggested_quantity > 0))`

## category_translations

| Column      | Type | Nullable | Default  |
| ----------- | ---- | -------- | -------- |
| category_id | uuid | NO       | —        |
| locale      | text | NO       | —        |
| name        | text | NO       | —        |
| description | text | NO       | ''::text |

Constraints:

- `FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE CASCADE`
- `FOREIGN KEY (locale) REFERENCES supported_locales(code)`
- `PRIMARY KEY (category_id, locale)`

## competitor_offers

| Column            | Type                     | Nullable | Default  |
| ----------------- | ------------------------ | -------- | -------- |
| id                | uuid                     | NO       | —        |
| sku               | text                     | NO       | —        |
| shop_id           | uuid                     | YES      | —        |
| url               | text                     | NO       | —        |
| title             | text                     | NO       | —        |
| brand             | text                     | YES      | —        |
| manufacturer_code | text                     | YES      | —        |
| ean               | text                     | YES      | —        |
| price_cents       | integer                  | YES      | —        |
| shipping_cents    | integer                  | YES      | —        |
| currency          | text                     | NO       | —        |
| in_stock          | boolean                  | YES      | —        |
| includes_vat      | boolean                  | YES      | —        |
| identity_verified | boolean                  | NO       | false    |
| pack_quantity     | numeric                  | YES      | —        |
| evidence          | text                     | NO       | ''::text |
| checked_at        | timestamp with time zone | NO       | now()    |
| expires_at        | timestamp with time zone | YES      | —        |

Constraints:

- `CHECK ((currency = ANY (ARRAY['EUR'::text, 'BGN'::text, 'unknown'::text])))`
- `CHECK ((pack_quantity > (0)::numeric))`
- `PRIMARY KEY (id)`
- `CHECK ((price_cents > 0))`
- `CHECK ((shipping_cents >= 0))`
- `FOREIGN KEY (shop_id) REFERENCES competitor_shops(id)`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku)`
- `UNIQUE (sku, url, checked_at)`

## competitor_shops

| Column     | Type                     | Nullable | Default |
| ---------- | ------------------------ | -------- | ------- |
| id         | uuid                     | NO       | —       |
| name       | text                     | NO       | —       |
| domain     | text                     | NO       | —       |
| active     | boolean                  | NO       | true    |
| created_at | timestamp with time zone | NO       | now()   |

Constraints:

- `UNIQUE (domain)`
- `PRIMARY KEY (id)`

## customer_addresses

| Column         | Type                     | Nullable | Default |
| -------------- | ------------------------ | -------- | ------- |
| id             | uuid                     | NO       | —       |
| customer_id    | uuid                     | NO       | —       |
| label          | text                     | NO       | —       |
| recipient_name | text                     | NO       | —       |
| phone          | text                     | NO       | —       |
| delivery       | jsonb                    | NO       | —       |
| is_default     | boolean                  | NO       | false   |
| created_at     | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE`
- `PRIMARY KEY (id)`

## customer_email_outbox

| Column          | Type                     | Nullable | Default |
| --------------- | ------------------------ | -------- | ------- |
| id              | uuid                     | NO       | —       |
| customer_id     | uuid                     | NO       | —       |
| recipient       | text                     | NO       | —       |
| subject         | text                     | NO       | —       |
| body            | text                     | NO       | —       |
| attempts        | integer                  | NO       | 0       |
| last_attempt_at | timestamp with time zone | YES      | —       |
| sent_at         | timestamp with time zone | YES      | —       |
| created_at      | timestamp with time zone | NO       | now()   |
| alert_id        | uuid                     | YES      | —       |
| reminder_id     | uuid                     | YES      | —       |

Constraints:

- `FOREIGN KEY (alert_id) REFERENCES customer_product_alerts(id) ON DELETE CASCADE`
- `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE`
- `PRIMARY KEY (id)`
- `FOREIGN KEY (reminder_id) REFERENCES customer_reminders(id) ON DELETE CASCADE`

## customer_favorites

| Column      | Type                     | Nullable | Default |
| ----------- | ------------------------ | -------- | ------- |
| customer_id | uuid                     | NO       | —       |
| sku         | text                     | NO       | —       |
| created_at  | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE`
- `PRIMARY KEY (customer_id, sku)`

## customer_product_alerts

| Column           | Type                     | Nullable | Default |
| ---------------- | ------------------------ | -------- | ------- |
| id               | uuid                     | NO       | —       |
| customer_id      | uuid                     | NO       | —       |
| sku              | text                     | NO       | —       |
| kind             | text                     | NO       | —       |
| last_price_cents | integer                  | NO       | —       |
| active           | boolean                  | NO       | true    |
| created_at       | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE`
- `UNIQUE (customer_id, sku, kind)`
- `CHECK ((kind = ANY (ARRAY['stock'::text, 'price'::text])))`
- `CHECK ((last_price_cents > 0))`
- `PRIMARY KEY (id)`

## customer_reminders

| Column            | Type                     | Nullable | Default |
| ----------------- | ------------------------ | -------- | ------- |
| id                | uuid                     | NO       | —       |
| customer_id       | uuid                     | NO       | —       |
| vehicle_id        | uuid                     | NO       | —       |
| title             | text                     | NO       | —       |
| last_service_date | date                     | YES      | —       |
| due_date          | date                     | NO       | —       |
| notified_at       | timestamp with time zone | YES      | —       |
| created_at        | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE`
- `PRIMARY KEY (id)`
- `FOREIGN KEY (vehicle_id) REFERENCES garage_vehicles(id) ON DELETE CASCADE`

## customer_sessions

| Column      | Type                     | Nullable | Default |
| ----------- | ------------------------ | -------- | ------- |
| token_hash  | text                     | NO       | —       |
| customer_id | uuid                     | NO       | —       |
| expires_at  | timestamp with time zone | NO       | —       |

Constraints:

- `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE`
- `PRIMARY KEY (token_hash)`

## customers

| Column                   | Type                     | Nullable | Default                                                       |
| ------------------------ | ------------------------ | -------- | ------------------------------------------------------------- |
| id                       | uuid                     | NO       | —                                                             |
| email                    | text                     | NO       | —                                                             |
| password_hash            | text                     | NO       | —                                                             |
| name                     | text                     | NO       | —                                                             |
| phone                    | text                     | NO       | —                                                             |
| delivery                 | jsonb                    | YES      | —                                                             |
| created_at               | timestamp with time zone | NO       | now()                                                         |
| email_verified_at        | timestamp with time zone | YES      | —                                                             |
| is_admin                 | boolean                  | NO       | false                                                         |
| notification_preferences | jsonb                    | NO       | '{"price": false, "stock": false, "reminders": false}'::jsonb |
| preferred_locale         | text                     | NO       | 'bg'::text                                                    |

Constraints:

- `UNIQUE (email)`
- `PRIMARY KEY (id)`
- `FOREIGN KEY (preferred_locale) REFERENCES supported_locales(code)`

## email_verifications

| Column            | Type                     | Nullable | Default |
| ----------------- | ------------------------ | -------- | ------- |
| customer_id       | uuid                     | NO       | —       |
| token_hash        | text                     | NO       | —       |
| expires_at        | timestamp with time zone | NO       | —       |
| sent_at           | timestamp with time zone | NO       | —       |
| window_started_at | timestamp with time zone | NO       | —       |
| send_count        | integer                  | NO       | —       |

Constraints:

- `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE`
- `PRIMARY KEY (customer_id)`
- `UNIQUE (token_hash)`

## garage_vehicles

| Column      | Type                     | Nullable | Default  |
| ----------- | ------------------------ | -------- | -------- |
| id          | uuid                     | NO       | —        |
| customer_id | uuid                     | NO       | —        |
| nickname    | text                     | NO       | ''::text |
| make        | text                     | NO       | —        |
| model       | text                     | NO       | —        |
| year        | integer                  | NO       | —        |
| engine      | text                     | NO       | —        |
| is_selected | boolean                  | NO       | false    |
| created_at  | timestamp with time zone | NO       | now()    |

Constraints:

- `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE`
- `PRIMARY KEY (id)`

## insight_ai_requests

| Column     | Type                     | Nullable | Default |
| ---------- | ------------------------ | -------- | ------- |
| id         | uuid                     | NO       | —       |
| admin_id   | uuid                     | NO       | —       |
| created_at | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (admin_id) REFERENCES customers(id) ON DELETE CASCADE`
- `PRIMARY KEY (id)`

## insight_conversations

| Column     | Type                     | Nullable | Default |
| ---------- | ------------------------ | -------- | ------- |
| id         | uuid                     | NO       | —       |
| admin_id   | uuid                     | NO       | —       |
| locale     | text                     | NO       | —       |
| created_at | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (admin_id) REFERENCES customers(id) ON DELETE CASCADE`
- `FOREIGN KEY (locale) REFERENCES supported_locales(code)`
- `PRIMARY KEY (id)`

## insight_messages

| Column          | Type                     | Nullable | Default     |
| --------------- | ------------------------ | -------- | ----------- |
| id              | uuid                     | NO       | —           |
| conversation_id | uuid                     | NO       | —           |
| role            | text                     | NO       | —           |
| content         | text                     | NO       | —           |
| sources         | jsonb                    | NO       | '[]'::jsonb |
| model           | text                     | YES      | —           |
| created_at      | timestamp with time zone | NO       | now()       |

Constraints:

- `FOREIGN KEY (conversation_id) REFERENCES insight_conversations(id) ON DELETE CASCADE`
- `PRIMARY KEY (id)`
- `CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))`

## invoice_ai_requests

| Column     | Type                     | Nullable | Default |
| ---------- | ------------------------ | -------- | ------- |
| id         | uuid                     | NO       | —       |
| actor_id   | uuid                     | YES      | —       |
| invoice_id | uuid                     | YES      | —       |
| kind       | text                     | NO       | —       |
| created_at | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (actor_id) REFERENCES customers(id)`
- `FOREIGN KEY (invoice_id) REFERENCES supplier_invoices(id)`
- `CHECK ((kind = ANY (ARRAY['extract'::text, 'market'::text])))`
- `PRIMARY KEY (id)`

## invoice_lines

| Column                  | Type    | Nullable | Default |
| ----------------------- | ------- | -------- | ------- |
| invoice_id              | uuid    | NO       | —       |
| line_number             | integer | NO       | —       |
| sku                     | text    | NO       | —       |
| description             | text    | NO       | —       |
| quantity                | integer | NO       | —       |
| unit_net_cents          | integer | NO       | —       |
| vat_bps                 | integer | NO       | —       |
| acquisition_total_cents | bigint  | NO       | —       |

Constraints:

- `CHECK ((acquisition_total_cents >= 0))`
- `FOREIGN KEY (invoice_id) REFERENCES supplier_invoices(id) ON DELETE CASCADE`
- `CHECK ((line_number > 0))`
- `PRIMARY KEY (invoice_id, line_number)`
- `CHECK ((quantity > 0))`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku)`
- `CHECK ((unit_net_cents >= 0))`
- `CHECK (((vat_bps >= 0) AND (vat_bps <= 10000)))`

## invoice_market_research

| Column           | Type                     | Nullable | Default |
| ---------------- | ------------------------ | -------- | ------- |
| id               | uuid                     | NO       | —       |
| invoice_id       | uuid                     | NO       | —       |
| product_identity | jsonb                    | NO       | —       |
| result           | jsonb                    | NO       | —       |
| actor_id         | uuid                     | YES      | —       |
| created_at       | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (actor_id) REFERENCES customers(id)`
- `FOREIGN KEY (invoice_id) REFERENCES supplier_invoices(id)`
- `PRIMARY KEY (id)`

## order_email_outbox

| Column          | Type                     | Nullable | Default |
| --------------- | ------------------------ | -------- | ------- |
| id              | uuid                     | NO       | —       |
| order_id        | uuid                     | NO       | —       |
| recipient       | text                     | NO       | —       |
| subject         | text                     | NO       | —       |
| body            | text                     | NO       | —       |
| attempts        | integer                  | NO       | 0       |
| sent_at         | timestamp with time zone | YES      | —       |
| last_attempt_at | timestamp with time zone | YES      | —       |
| created_at      | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE`
- `PRIMARY KEY (id)`

## order_history

| Column     | Type                     | Nullable | Default |
| ---------- | ------------------------ | -------- | ------- |
| id         | uuid                     | NO       | —       |
| order_id   | uuid                     | NO       | —       |
| status     | text                     | NO       | —       |
| actor_id   | uuid                     | YES      | —       |
| created_at | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (actor_id) REFERENCES customers(id) ON DELETE SET NULL`
- `FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE`
- `PRIMARY KEY (id)`

## order_lines

| Column           | Type    | Nullable | Default |
| ---------------- | ------- | -------- | ------- |
| order_id         | uuid    | NO       | —       |
| line_number      | integer | NO       | —       |
| sku              | text    | NO       | —       |
| name             | text    | NO       | —       |
| quantity         | integer | NO       | —       |
| unit_price_cents | integer | NO       | —       |
| unit_cost_cents  | integer | YES      | —       |
| vat_bps          | integer | NO       | 2000    |

Constraints:

- `CHECK ((line_number > 0))`
- `FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE`
- `PRIMARY KEY (order_id, line_number)`
- `CHECK ((quantity > 0))`
- `CHECK ((unit_cost_cents >= 0))`
- `CHECK ((unit_price_cents > 0))`
- `CHECK (((vat_bps >= 0) AND (vat_bps <= 10000)))`

## orders

| Column            | Type                     | Nullable | Default          |
| ----------------- | ------------------------ | -------- | ---------------- |
| id                | uuid                     | NO       | —                |
| mode              | text                     | NO       | 'test'::text     |
| customer_id       | uuid                     | YES      | —                |
| request_key       | uuid                     | NO       | —                |
| request_hash      | text                     | NO       | —                |
| access_hash       | text                     | NO       | —                |
| contact           | jsonb                    | NO       | —                |
| delivery          | jsonb                    | NO       | —                |
| destination       | text                     | NO       | —                |
| lines             | jsonb                    | NO       | —                |
| subtotal_cents    | integer                  | NO       | —                |
| shipping_cents    | integer                  | NO       | —                |
| total_cents       | integer                  | NO       | —                |
| currency          | text                     | NO       | 'eur'::text      |
| payment_method    | text                     | NO       | —                |
| payment_status    | text                     | NO       | —                |
| status            | text                     | NO       | 'received'::text |
| stripe_session_id | text                     | YES      | —                |
| payment_url       | text                     | YES      | —                |
| tracking_number   | text                     | YES      | —                |
| created_at        | timestamp with time zone | NO       | now()            |
| updated_at        | timestamp with time zone | NO       | now()            |
| locale            | text                     | NO       | 'bg'::text       |

Constraints:

- `CHECK ((total_cents = (subtotal_cents + shipping_cents)))`
- `CHECK ((currency = 'eur'::text))`
- `FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL`
- `FOREIGN KEY (locale) REFERENCES supported_locales(code)`
- `CHECK ((mode = 'test'::text))`
- `CHECK ((payment_method = ANY (ARRAY['cod'::text, 'card'::text])))`
- `CHECK ((payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'due_on_delivery'::text, 'failed'::text])))`
- `PRIMARY KEY (id)`
- `UNIQUE (request_key)`
- `CHECK ((shipping_cents >= 0))`
- `CHECK ((status = ANY (ARRAY['received'::text, 'confirmed'::text, 'preparing'::text, 'ready'::text, 'handed_to_courier'::text, 'cancelled'::text])))`
- `UNIQUE (stripe_session_id)`
- `CHECK ((subtotal_cents > 0))`

## payment_events

| Column     | Type                     | Nullable | Default |
| ---------- | ------------------------ | -------- | ------- |
| id         | text                     | NO       | —       |
| order_id   | uuid                     | NO       | —       |
| created_at | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE`
- `PRIMARY KEY (id)`

## payments

| Column             | Type                     | Nullable | Default |
| ------------------ | ------------------------ | -------- | ------- |
| id                 | uuid                     | NO       | —       |
| order_id           | uuid                     | NO       | —       |
| provider           | text                     | NO       | —       |
| external_reference | text                     | YES      | —       |
| idempotency_key    | text                     | NO       | —       |
| amount_cents       | integer                  | NO       | —       |
| currency           | text                     | NO       | —       |
| status             | text                     | NO       | —       |
| created_at         | timestamp with time zone | NO       | now()   |
| paid_at            | timestamp with time zone | YES      | —       |

Constraints:

- `CHECK ((amount_cents > 0))`
- `CHECK ((currency = 'EUR'::text))`
- `UNIQUE (idempotency_key)`
- `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `PRIMARY KEY (id)`
- `CHECK ((provider = ANY (ARRAY['stripe'::text, 'simulator'::text, 'cod'::text, 'bank_transfer'::text])))`
- `UNIQUE (provider, external_reference)`
- `CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'part_refunded'::text, 'cancelled'::text])))`

## product_categories

| Column     | Type    | Nullable | Default |
| ---------- | ------- | -------- | ------- |
| id         | uuid    | NO       | —       |
| slug       | text    | NO       | —       |
| parent_id  | uuid    | YES      | —       |
| sort_order | integer | NO       | 0       |
| active     | boolean | NO       | true    |

Constraints:

- `CHECK ((parent_id <> id))`
- `FOREIGN KEY (parent_id) REFERENCES product_categories(id)`
- `PRIMARY KEY (id)`
- `UNIQUE (slug)`

## product_fitments

| Column    | Type    | Nullable | Default |
| --------- | ------- | -------- | ------- |
| sku       | text    | NO       | —       |
| make      | text    | NO       | —       |
| model     | text    | NO       | —       |
| engine    | text    | NO       | —       |
| year_from | integer | NO       | —       |
| year_to   | integer | NO       | —       |

Constraints:

- `CHECK ((year_to >= year_from))`
- `PRIMARY KEY (sku, make, model, engine, year_from, year_to)`

## product_images

| Column      | Type    | Nullable | Default     |
| ----------- | ------- | -------- | ----------- |
| id          | uuid    | NO       | —           |
| sku         | text    | NO       | —           |
| storage_key | text    | NO       | —           |
| alt_text    | jsonb   | NO       | '{}'::jsonb |
| sort_order  | integer | NO       | 0           |

Constraints:

- `PRIMARY KEY (id)`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku) ON DELETE CASCADE`

## product_media

| Column      | Type                     | Nullable | Default                       |
| ----------- | ------------------------ | -------- | ----------------------------- |
| id          | uuid                     | NO       | —                             |
| sku         | text                     | NO       | —                             |
| kind        | text                     | NO       | —                             |
| mime_type   | text                     | NO       | —                             |
| filename    | text                     | NO       | —                             |
| content     | bytea                    | NO       | —                             |
| alt_text    | jsonb                    | NO       | '{"bg": "", "en": ""}'::jsonb |
| sort_order  | integer                  | NO       | 0                             |
| is_primary  | boolean                  | NO       | false                         |
| uploaded_by | uuid                     | YES      | —                             |
| created_at  | timestamp with time zone | NO       | now()                         |

Constraints:

- `CHECK (((NOT is_primary) OR (kind = 'image'::text)))`
- `CHECK (((octet_length(content) >= 12) AND (octet_length(content) <= 52428800)))`
- `CHECK ((kind = ANY (ARRAY['image'::text, 'video'::text])))`
- `CHECK ((mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text, 'video/mp4'::text, 'video/webm'::text])))`
- `PRIMARY KEY (id)`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku) ON DELETE CASCADE`
- `CHECK ((sort_order >= 0))`
- `FOREIGN KEY (uploaded_by) REFERENCES customers(id) ON DELETE SET NULL`

## product_price_history

| Column            | Type                     | Nullable | Default |
| ----------------- | ------------------------ | -------- | ------- |
| id                | uuid                     | NO       | —       |
| sku               | text                     | NO       | —       |
| gross_price_cents | integer                  | NO       | —       |
| source            | text                     | NO       | —       |
| actor_id          | uuid                     | YES      | —       |
| created_at        | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (actor_id) REFERENCES customers(id)`
- `CHECK ((gross_price_cents > 0))`
- `PRIMARY KEY (id)`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku)`

## product_translations

| Column         | Type                     | Nullable | Default     |
| -------------- | ------------------------ | -------- | ----------- |
| sku            | text                     | NO       | —           |
| locale         | text                     | NO       | —           |
| name           | text                     | NO       | —           |
| description    | text                     | NO       | ''::text    |
| specifications | jsonb                    | NO       | '{}'::jsonb |
| updated_at     | timestamp with time zone | NO       | now()       |

Constraints:

- `FOREIGN KEY (locale) REFERENCES supported_locales(code)`
- `PRIMARY KEY (sku, locale)`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku) ON DELETE CASCADE`

## promotion_lines

| Column              | Type    | Nullable | Default |
| ------------------- | ------- | -------- | ------- |
| promotion_id        | uuid    | NO       | —       |
| sku                 | text    | NO       | —       |
| regular_price_cents | integer | NO       | —       |
| sale_price_cents    | integer | NO       | —       |
| minimum_margin_bps  | integer | NO       | 0       |

Constraints:

- `CHECK (((sale_price_cents > 0) AND (sale_price_cents < regular_price_cents)))`
- `CHECK (((minimum_margin_bps >= 0) AND (minimum_margin_bps <= 10000)))`
- `PRIMARY KEY (promotion_id, sku)`
- `FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE`
- `CHECK ((regular_price_cents > 0))`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku)`

## promotions

| Column      | Type                     | Nullable | Default       |
| ----------- | ------------------------ | -------- | ------------- |
| id          | uuid                     | NO       | —             |
| name        | text                     | NO       | —             |
| status      | text                     | NO       | 'draft'::text |
| starts_at   | timestamp with time zone | YES      | —             |
| ends_at     | timestamp with time zone | YES      | —             |
| created_by  | uuid                     | YES      | —             |
| approved_by | uuid                     | YES      | —             |
| created_at  | timestamp with time zone | NO       | now()         |

Constraints:

- `FOREIGN KEY (approved_by) REFERENCES customers(id)`
- `CHECK (((ends_at IS NULL) OR (starts_at IS NULL) OR (ends_at > starts_at)))`
- `FOREIGN KEY (created_by) REFERENCES customers(id)`
- `PRIMARY KEY (id)`
- `CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'active'::text, 'ended'::text, 'cancelled'::text])))`

## purchase_order_lines

| Column            | Type    | Nullable | Default |
| ----------------- | ------- | -------- | ------- |
| purchase_order_id | uuid    | NO       | —       |
| sku               | text    | NO       | —       |
| quantity          | integer | NO       | —       |
| received_quantity | integer | NO       | 0       |
| unit_net_cents    | integer | YES      | —       |

Constraints:

- `CHECK (((received_quantity >= 0) AND (received_quantity <= quantity)))`
- `PRIMARY KEY (purchase_order_id, sku)`
- `FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE`
- `CHECK ((quantity > 0))`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku)`
- `CHECK ((unit_net_cents >= 0))`

## purchase_orders

| Column        | Type                     | Nullable | Default       |
| ------------- | ------------------------ | -------- | ------------- |
| id            | uuid                     | NO       | —             |
| supplier_id   | uuid                     | NO       | —             |
| status        | text                     | NO       | 'draft'::text |
| currency      | text                     | NO       | 'EUR'::text   |
| expected_date | date                     | YES      | —             |
| note          | text                     | NO       | ''::text      |
| created_by    | uuid                     | YES      | —             |
| approved_by   | uuid                     | YES      | —             |
| created_at    | timestamp with time zone | NO       | now()         |
| approved_at   | timestamp with time zone | YES      | —             |

Constraints:

- `FOREIGN KEY (approved_by) REFERENCES customers(id)`
- `FOREIGN KEY (created_by) REFERENCES customers(id)`
- `CHECK ((currency = ANY (ARRAY['EUR'::text, 'BGN'::text])))`
- `PRIMARY KEY (id)`
- `CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'sent'::text, 'part_received'::text, 'received'::text, 'cancelled'::text])))`
- `FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`

## rag_chunks

| Column        | Type     | Nullable | Default |
| ------------- | -------- | -------- | ------- |
| id            | uuid     | NO       | —       |
| document_id   | uuid     | NO       | —       |
| chunk_number  | integer  | NO       | —       |
| content       | text     | NO       | —       |
| search_vector | tsvector | YES      | —       |

Constraints:

- `CHECK ((chunk_number >= 0))`
- `UNIQUE (document_id, chunk_number)`
- `FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE`
- `PRIMARY KEY (id)`

## rag_documents

| Column       | Type                     | Nullable | Default |
| ------------ | ------------------------ | -------- | ------- |
| id           | uuid                     | NO       | —       |
| source_type  | text                     | NO       | —       |
| source_id    | text                     | NO       | —       |
| locale       | text                     | NO       | —       |
| title        | text                     | NO       | —       |
| content_hash | text                     | NO       | —       |
| updated_at   | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (locale) REFERENCES supported_locales(code)`
- `PRIMARY KEY (id)`
- `CHECK ((source_type = ANY (ARRAY['invoice'::text, 'product'::text, 'policy'::text])))`
- `UNIQUE (source_type, source_id, locale)`

## refunds

| Column             | Type                     | Nullable | Default |
| ------------------ | ------------------------ | -------- | ------- |
| id                 | uuid                     | NO       | —       |
| payment_id         | uuid                     | NO       | —       |
| external_reference | text                     | YES      | —       |
| amount_cents       | integer                  | NO       | —       |
| status             | text                     | NO       | —       |
| reason             | text                     | NO       | —       |
| actor_id           | uuid                     | YES      | —       |
| created_at         | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (actor_id) REFERENCES customers(id)`
- `CHECK ((amount_cents > 0))`
- `UNIQUE (external_reference)`
- `FOREIGN KEY (payment_id) REFERENCES payments(id)`
- `PRIMARY KEY (id)`
- `CHECK ((status = ANY (ARRAY['requested'::text, 'pending'::text, 'succeeded'::text, 'failed'::text])))`

## shipment_events

| Column            | Type                     | Nullable | Default     |
| ----------------- | ------------------------ | -------- | ----------- |
| id                | uuid                     | NO       | —           |
| shipment_id       | uuid                     | NO       | —           |
| external_event_id | text                     | NO       | —           |
| status            | text                     | NO       | —           |
| occurred_at       | timestamp with time zone | NO       | —           |
| payload           | jsonb                    | NO       | '{}'::jsonb |

Constraints:

- `PRIMARY KEY (id)`
- `UNIQUE (shipment_id, external_event_id)`
- `FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE`

## shipments

| Column                  | Type                     | Nullable | Default |
| ----------------------- | ------------------------ | -------- | ------- |
| id                      | uuid                     | NO       | —       |
| order_id                | uuid                     | NO       | —       |
| courier                 | text                     | NO       | —       |
| delivery_type           | text                     | NO       | —       |
| office_id               | text                     | YES      | —       |
| destination             | jsonb                    | NO       | —       |
| external_reference      | text                     | YES      | —       |
| tracking_number         | text                     | YES      | —       |
| customer_shipping_cents | integer                  | NO       | —       |
| merchant_shipping_cents | integer                  | YES      | —       |
| quote                   | jsonb                    | YES      | —       |
| status                  | text                     | NO       | —       |
| idempotency_key         | text                     | NO       | —       |
| created_at              | timestamp with time zone | NO       | now()   |

Constraints:

- `CHECK ((courier = ANY (ARRAY['speedy'::text, 'econt'::text])))`
- `UNIQUE (courier, external_reference)`
- `CHECK ((customer_shipping_cents >= 0))`
- `CHECK ((delivery_type = ANY (ARRAY['office'::text, 'address'::text])))`
- `UNIQUE (idempotency_key)`
- `CHECK ((merchant_shipping_cents >= 0))`
- `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `PRIMARY KEY (id)`
- `CHECK ((status = ANY (ARRAY['draft'::text, 'quoted'::text, 'label_created'::text, 'handed_over'::text, 'delivered'::text, 'returned'::text, 'cancelled'::text])))`

## stock_movements

| Column          | Type                     | Nullable | Default  |
| --------------- | ------------------------ | -------- | -------- |
| id              | uuid                     | NO       | —        |
| sku             | text                     | NO       | —        |
| kind            | text                     | NO       | —        |
| quantity        | integer                  | NO       | —        |
| reference_key   | text                     | NO       | —        |
| invoice_id      | uuid                     | YES      | —        |
| order_id        | uuid                     | YES      | —        |
| actor_id        | uuid                     | YES      | —        |
| unit_cost_cents | integer                  | YES      | —        |
| note            | text                     | NO       | ''::text |
| created_at      | timestamp with time zone | NO       | now()    |

Constraints:

- `FOREIGN KEY (actor_id) REFERENCES customers(id)`
- `CHECK (((quantity <> 0) AND ((kind = 'adjustment'::text) OR (quantity > 0))))`
- `FOREIGN KEY (invoice_id) REFERENCES supplier_invoices(id)`
- `CHECK ((kind = ANY (ARRAY['receipt'::text, 'reserve'::text, 'release'::text, 'sale'::text, 'return'::text, 'adjustment'::text])))`
- `FOREIGN KEY (order_id) REFERENCES orders(id)`
- `PRIMARY KEY (id)`
- `UNIQUE (reference_key)`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku)`
- `CHECK ((unit_cost_cents >= 0))`

## stock_reservations

| Column     | Type                     | Nullable | Default |
| ---------- | ------------------------ | -------- | ------- |
| id         | uuid                     | NO       | —       |
| order_id   | uuid                     | NO       | —       |
| sku        | text                     | NO       | —       |
| quantity   | integer                  | NO       | —       |
| status     | text                     | NO       | —       |
| expires_at | timestamp with time zone | NO       | —       |
| created_at | timestamp with time zone | NO       | now()   |

Constraints:

- `FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE`
- `UNIQUE (order_id, sku)`
- `PRIMARY KEY (id)`
- `CHECK ((quantity > 0))`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku)`
- `CHECK ((status = ANY (ARRAY['active'::text, 'consumed'::text, 'released'::text, 'expired'::text])))`

## store_delivery_settings

| Column                    | Type                     | Nullable | Default |
| ------------------------- | ------------------------ | -------- | ------- |
| id                        | integer                  | NO       | —       |
| free_shipping_enabled     | boolean                  | NO       | —       |
| free_shipping_above_cents | integer                  | NO       | —       |
| updated_at                | timestamp with time zone | NO       | now()   |
| updated_by                | uuid                     | YES      | —       |

Constraints:

- `CHECK (((free_shipping_above_cents >= 0) AND (free_shipping_above_cents <= 100000000)))`
- `CHECK ((id = 1))`
- `PRIMARY KEY (id)`
- `FOREIGN KEY (updated_by) REFERENCES customers(id)`

## store_pricing_settings

| Column     | Type                     | Nullable | Default |
| ---------- | ------------------------ | -------- | ------- |
| id         | integer                  | NO       | —       |
| settings   | jsonb                    | NO       | —       |
| updated_at | timestamp with time zone | NO       | now()   |
| updated_by | uuid                     | YES      | —       |

Constraints:

- `CHECK ((id = 1))`
- `PRIMARY KEY (id)`
- `FOREIGN KEY (updated_by) REFERENCES customers(id)`

## supplier_invoices

| Column              | Type                     | Nullable | Default       |
| ------------------- | ------------------------ | -------- | ------------- |
| id                  | uuid                     | NO       | —             |
| sha256              | text                     | NO       | —             |
| filename            | text                     | NO       | —             |
| pdf                 | bytea                    | NO       | —             |
| uploaded_by         | uuid                     | YES      | —             |
| created_at          | timestamp with time zone | NO       | now()         |
| status              | text                     | NO       | 'draft'::text |
| parse_status        | text                     | NO       | 'idle'::text  |
| ai_started_at       | timestamp with time zone | YES      | —             |
| extracted           | jsonb                    | YES      | —             |
| reviewed            | jsonb                    | YES      | —             |
| supplier_key        | text                     | YES      | —             |
| invoice_number      | text                     | YES      | —             |
| posted_at           | timestamp with time zone | YES      | —             |
| posted_by           | uuid                     | YES      | —             |
| pricing_assumptions | jsonb                    | YES      | —             |
| supplier_id         | uuid                     | YES      | —             |

Constraints:

- `CHECK ((parse_status = ANY (ARRAY['idle'::text, 'processing'::text, 'ready'::text, 'failed'::text])))`
- `CHECK (((octet_length(pdf) >= 5) AND (octet_length(pdf) <= 10485760)))`
- `PRIMARY KEY (id)`
- `FOREIGN KEY (posted_by) REFERENCES customers(id)`
- `UNIQUE (sha256)`
- `CHECK ((status = ANY (ARRAY['draft'::text, 'posted'::text])))`
- `FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`
- `FOREIGN KEY (uploaded_by) REFERENCES customers(id)`

## supplier_products

| Column                 | Type                     | Nullable | Default     |
| ---------------------- | ------------------------ | -------- | ----------- |
| supplier_id            | uuid                     | NO       | —           |
| sku                    | text                     | NO       | —           |
| supplier_code          | text                     | NO       | ''::text    |
| last_unit_net_cents    | integer                  | YES      | —           |
| currency               | text                     | NO       | 'EUR'::text |
| minimum_order_quantity | integer                  | NO       | 1           |
| lead_time_days         | integer                  | YES      | —           |
| updated_at             | timestamp with time zone | NO       | now()       |

Constraints:

- `CHECK ((currency = ANY (ARRAY['EUR'::text, 'BGN'::text])))`
- `CHECK ((last_unit_net_cents >= 0))`
- `CHECK ((lead_time_days >= 0))`
- `CHECK ((minimum_order_quantity > 0))`
- `PRIMARY KEY (supplier_id, sku)`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku)`
- `FOREIGN KEY (supplier_id) REFERENCES suppliers(id)`

## suppliers

| Column             | Type                     | Nullable | Default     |
| ------------------ | ------------------------ | -------- | ----------- |
| id                 | uuid                     | NO       | —           |
| business_name      | text                     | NO       | —           |
| tax_id             | text                     | NO       | —           |
| contact_email      | text                     | YES      | —           |
| contact_phone      | text                     | YES      | —           |
| address            | jsonb                    | NO       | '{}'::jsonb |
| currency           | text                     | NO       | 'EUR'::text |
| payment_terms_days | integer                  | YES      | —           |
| active             | boolean                  | NO       | true        |
| created_at         | timestamp with time zone | NO       | now()       |
| updated_at         | timestamp with time zone | NO       | now()       |

Constraints:

- `CHECK ((currency = ANY (ARRAY['EUR'::text, 'BGN'::text])))`
- `CHECK ((payment_terms_days >= 0))`
- `PRIMARY KEY (id)`
- `UNIQUE (tax_id)`

## supported_locales

| Column | Type | Nullable | Default |
| ------ | ---- | -------- | ------- |
| code   | text | NO       | —       |
| name   | text | NO       | —       |

Constraints:

- `CHECK ((code = ANY (ARRAY['bg'::text, 'en'::text])))`
- `PRIMARY KEY (code)`

## warehouse_products

| Column                | Type                     | Nullable | Default       |
| --------------------- | ------------------------ | -------- | ------------- |
| sku                   | text                     | NO       | —             |
| name                  | text                     | NO       | —             |
| brand                 | text                     | NO       | —             |
| manufacturer_code     | text                     | NO       | —             |
| ean                   | text                     | NO       | —             |
| on_hand               | integer                  | NO       | 0             |
| reserved              | integer                  | NO       | 0             |
| inventory_value_cents | bigint                   | NO       | 0             |
| created_at            | timestamp with time zone | NO       | now()         |
| updated_at            | timestamp with time zone | NO       | now()         |
| category_id           | uuid                     | YES      | —             |
| status                | text                     | NO       | 'draft'::text |
| selling_price_cents   | integer                  | YES      | —             |
| vat_bps               | integer                  | NO       | 2000          |
| weight_grams          | integer                  | YES      | —             |
| dimensions_mm         | jsonb                    | YES      | —             |
| min_stock             | integer                  | NO       | 0             |
| target_stock          | integer                  | NO       | 0             |
| lead_time_days        | integer                  | NO       | 7             |

Constraints:

- `FOREIGN KEY (category_id) REFERENCES product_categories(id)`
- `CHECK (((reserved >= 0) AND (reserved <= on_hand)))`
- `CHECK ((target_stock >= min_stock))`
- `CHECK ((inventory_value_cents >= 0))`
- `CHECK (((lead_time_days >= 0) AND (lead_time_days <= 365)))`
- `CHECK ((min_stock >= 0))`
- `CHECK ((on_hand >= 0))`
- `PRIMARY KEY (sku)`
- `CHECK ((selling_price_cents > 0))`
- `CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))`
- `CHECK (((vat_bps >= 0) AND (vat_bps <= 10000)))`
- `CHECK ((weight_grams > 0))`

## warehouse_receipts

| Column                  | Type                     | Nullable | Default |
| ----------------------- | ------------------------ | -------- | ------- |
| id                      | uuid                     | NO       | —       |
| invoice_id              | uuid                     | NO       | —       |
| line_number             | integer                  | NO       | —       |
| sku                     | text                     | NO       | —       |
| quantity                | integer                  | NO       | —       |
| acquisition_total_cents | bigint                   | NO       | —       |
| actor_id                | uuid                     | YES      | —       |
| created_at              | timestamp with time zone | NO       | now()   |

Constraints:

- `CHECK ((acquisition_total_cents >= 0))`
- `FOREIGN KEY (actor_id) REFERENCES customers(id)`
- `FOREIGN KEY (invoice_id) REFERENCES supplier_invoices(id)`
- `UNIQUE (invoice_id, line_number)`
- `PRIMARY KEY (id)`
- `CHECK ((quantity > 0))`
- `FOREIGN KEY (sku) REFERENCES warehouse_products(sku)`
