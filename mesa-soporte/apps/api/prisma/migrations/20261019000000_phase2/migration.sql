-- Phase 2: knowledge base, SSO identities, WebAuthn, Azure DevOps, Teams, webhook deliveries.

-- array_to_string is only STABLE; a text[] of words joins the same way every time.
CREATE OR REPLACE FUNCTION mesa_join_words(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT array_to_string($1, ' ') $$;

-- CreateTable
CREATE TABLE "kb_categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "names" JSONB NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kb_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_answers" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "visibility" VARCHAR(10) NOT NULL DEFAULT 'customer',
    "state" VARCHAR(10) NOT NULL DEFAULT 'draft',
    "publish_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kb_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_translations" (
    "id" UUID NOT NULL,
    "answer_id" UUID NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "body_html" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "search_vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', mesa_unaccent(coalesce("title", ''))), 'A') ||
        setweight(to_tsvector('english', mesa_unaccent(coalesce("title", ''))), 'A') ||
        setweight(to_tsvector('simple', mesa_unaccent(coalesce(mesa_join_words("keywords"), ''))), 'B') ||
        to_tsvector('spanish', mesa_unaccent(left(coalesce("body_text", ''), 100000))) ||
        to_tsvector('english', mesa_unaccent(left(coalesce("body_text", ''), 100000)))
    ) STORED,

    CONSTRAINT "kb_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_translation_versions" (
    "id" UUID NOT NULL,
    "translation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "body_html" TEXT NOT NULL,
    "edited_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_translation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "issuer" VARCHAR(300) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "email" VARCHAR(254),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_id" VARCHAR(512) NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "name" VARCHAR(80) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devops_links" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "work_item_id" INTEGER NOT NULL,
    "work_item_type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "state" VARCHAR(60) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devops_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams_channels" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "url_enc" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "target_id" UUID NOT NULL,
    "ticket_id" UUID,
    "event" VARCHAR(40) NOT NULL,
    "status" INTEGER,
    "error" VARCHAR(500),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kb_categories_slug_key" ON "kb_categories"("slug");

-- CreateIndex
CREATE INDEX "kb_answers_category_id_idx" ON "kb_answers"("category_id");

-- CreateIndex
CREATE INDEX "kb_answers_state_visibility_idx" ON "kb_answers"("state", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "kb_translations_answer_id_locale_key" ON "kb_translations"("answer_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "kb_translation_versions_translation_id_version_key" ON "kb_translation_versions"("translation_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_issuer_subject_key" ON "user_identities"("issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_user_id_provider_key" ON "user_identities"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_user_id_idx" ON "webauthn_credentials"("user_id");

-- CreateIndex
CREATE INDEX "devops_links_work_item_id_idx" ON "devops_links"("work_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "devops_links_ticket_id_work_item_id_key" ON "devops_links"("ticket_id", "work_item_id");

-- CreateIndex
CREATE INDEX "teams_channels_group_id_idx" ON "teams_channels"("group_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_target_id_created_at_idx" ON "webhook_deliveries"("target_id", "created_at");

-- AddForeignKey
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "kb_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_answers" ADD CONSTRAINT "kb_answers_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "kb_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_translations" ADD CONSTRAINT "kb_translations_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "kb_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_translation_versions" ADD CONSTRAINT "kb_translation_versions_translation_id_fkey" FOREIGN KEY ("translation_id") REFERENCES "kb_translations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devops_links" ADD CONSTRAINT "devops_links_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "kb_translations_search_idx" ON "kb_translations" USING GIN ("search_vector");

-- Knowledge base versions are append-only.
CREATE TRIGGER "kb_versions_no_update"
  BEFORE UPDATE ON "kb_translation_versions"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_mutation"();

-- Starting category structure (one per Inncentives module); content is loaded by people.
INSERT INTO "kb_categories" ("id", "parent_id", "names", "slug", "position", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000a01', NULL, '{"es-MX":"Primeros pasos","en":"Getting started"}', 'primeros-pasos', 10, now()),
  ('00000000-0000-4000-8000-000000000a02', NULL, '{"es-MX":"Organización","en":"Organization"}', 'organizacion', 20, now()),
  ('00000000-0000-4000-8000-000000000a03', NULL, '{"es-MX":"Beneficiarios","en":"Beneficiaries"}', 'beneficiarios', 30, now()),
  ('00000000-0000-4000-8000-000000000a04', NULL, '{"es-MX":"Tablas dinámicas","en":"Dynamic tables"}', 'tablas', 40, now()),
  ('00000000-0000-4000-8000-000000000a05', NULL, '{"es-MX":"Carga de datos","en":"Data upload"}', 'carga', 50, now()),
  ('00000000-0000-4000-8000-000000000a06', NULL, '{"es-MX":"Calendarios","en":"Calendars"}', 'calendarios', 60, now()),
  ('00000000-0000-4000-8000-000000000a07', NULL, '{"es-MX":"Planes de compensación","en":"Compensation plans"}', 'planes', 70, now()),
  ('00000000-0000-4000-8000-000000000a08', NULL, '{"es-MX":"Procesos calendarizados","en":"Scheduled processes"}', 'procesos', 80, now()),
  ('00000000-0000-4000-8000-000000000a09', NULL, '{"es-MX":"Flujos","en":"Workflows"}', 'flujos', 90, now()),
  ('00000000-0000-4000-8000-000000000a0a', NULL, '{"es-MX":"Reportes","en":"Reports"}', 'reportes', 100, now()),
  ('00000000-0000-4000-8000-000000000a0b', NULL, '{"es-MX":"Portal","en":"Portal"}', 'portal', 110, now()),
  ('00000000-0000-4000-8000-000000000a0c', NULL, '{"es-MX":"Centro de Comando","en":"Command Center"}', 'centro-comando', 120, now()),
  ('00000000-0000-4000-8000-000000000a0d', NULL, '{"es-MX":"Seguridad y usuarios","en":"Security and users"}', 'seguridad', 130, now()),
  ('00000000-0000-4000-8000-000000000a0e', NULL, '{"es-MX":"API","en":"API"}', 'api', 140, now());

INSERT INTO "overviews" ("id", "name", "slug", "conditions", "columns", "order_by", "order_dir", "roles", "position", "updated_at") VALUES
  ('00000000-0000-4000-8000-000000000510', 'Mis menciones', 'mis-menciones',
   '{"op":"and","conditions":[{"field":"ticket.mentioned_user_id","operator":"is","value":"current_user"},{"field":"ticket.state","operator":"in","value":["new","open","pending_reminder","pending_close"]}]}',
   ARRAY['number','title','customer','state','updated_at'], 'updated_at', 'desc', ARRAY['ADMIN','AGENT'], 70, now());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "kb_categories", "kb_answers", "kb_translations", "user_identities",
      "webauthn_credentials", "devops_links", "teams_channels", "webhook_deliveries" TO app_rw;
    GRANT SELECT, INSERT, DELETE ON "kb_translation_versions" TO app_rw;
  END IF;
END;
$$;
