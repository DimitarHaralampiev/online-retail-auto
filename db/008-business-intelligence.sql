CREATE TABLE IF NOT EXISTS analytics_runs (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES customers(id) ON DELETE SET NULL,
 days integer NOT NULL CHECK(days BETWEEN 1 AND 365), includes_test_orders boolean NOT NULL DEFAULT false,
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS business_recommendations (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES analytics_runs(id) ON DELETE CASCADE,
 sku text NOT NULL REFERENCES warehouse_products(sku),
 kind text NOT NULL CHECK(kind IN ('reorder','promotion','price_review','catalog_review')),
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','dismissed','outdated')),
 title text NOT NULL, explanation text NOT NULL, evidence jsonb NOT NULL,
 suggested_quantity integer CHECK(suggested_quantity>0), suggested_price_cents integer CHECK(suggested_price_cents>0),
 target_type text, target_id uuid, decided_by uuid REFERENCES customers(id) ON DELETE SET NULL,
 decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_recommendations_status ON business_recommendations(status,created_at);
CREATE TABLE IF NOT EXISTS rag_documents (
 id uuid PRIMARY KEY, source_type text NOT NULL CHECK(source_type IN ('invoice','product','policy')),
 source_id text NOT NULL, locale text NOT NULL REFERENCES supported_locales(code),
 title text NOT NULL, content_hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_type,source_id,locale)
);
CREATE TABLE IF NOT EXISTS rag_chunks (
 id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
 chunk_number integer NOT NULL CHECK(chunk_number>=0), content text NOT NULL,
 search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',content)) STORED,
 UNIQUE(document_id,chunk_number)
);
CREATE INDEX IF NOT EXISTS rag_chunks_search ON rag_chunks USING gin(search_vector);
CREATE TABLE IF NOT EXISTS insight_conversations (
 id uuid PRIMARY KEY, admin_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 locale text NOT NULL REFERENCES supported_locales(code), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS insight_messages (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES insight_conversations(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL,
 sources jsonb NOT NULL DEFAULT '[]', model text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS insight_ai_requests (
 id uuid PRIMARY KEY, admin_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
