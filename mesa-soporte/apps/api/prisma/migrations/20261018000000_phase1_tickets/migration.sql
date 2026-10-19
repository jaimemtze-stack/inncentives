-- Accent-insensitive full-text search (Spanish + English). unaccent is a
-- trusted extension: the database owner (app_migrator) can create it.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION mesa_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "custom_fields" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "notes" VARCHAR(2000),
ADD COLUMN     "support_plan_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "custom_fields" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "mobile" VARCHAR(20),
ADD COLUMN     "notification_prefs" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "org_ticket_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "out_of_office" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "out_of_office_until" TIMESTAMPTZ(3),
ADD COLUMN     "phone" VARCHAR(20),
ADD COLUMN     "replacement_id" UUID;

-- CreateTable
CREATE TABLE "user_secondary_organizations" (
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,

    CONSTRAINT "user_secondary_organizations_pkey" PRIMARY KEY ("user_id","organization_id")
);

-- CreateTable
CREATE TABLE "custom_roles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "permissions" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_custom_roles" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "user_custom_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "support_plans" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "included_minutes_per_month" INTEGER,
    "hourly_rate_cents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email_address" VARCHAR(254),
    "signature_id" UUID,
    "follow_up" VARCHAR(20) NOT NULL DEFAULT 'reopen',
    "auto_assign" BOOLEAN NOT NULL DEFAULT false,
    "is_triage" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_access" (
    "user_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "levels" TEXT[],

    CONSTRAINT "group_access_pkey" PRIMARY KEY ("user_id","group_id")
);

-- CreateTable
CREATE TABLE "ticket_priorities" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "rank" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ticket_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_calendars" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "hours" JSONB NOT NULL,
    "holidays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mexico_statutory" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slas" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{"op":"and","conditions":[]}',
    "calendar_id" UUID NOT NULL,
    "pause_on_pending" BOOLEAN NOT NULL DEFAULT true,
    "warn_percent" INTEGER NOT NULL DEFAULT 80,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_targets" (
    "sla_id" UUID NOT NULL,
    "priority_id" UUID NOT NULL,
    "first_response_minutes" INTEGER,
    "update_minutes" INTEGER,
    "solution_minutes" INTEGER,

    CONSTRAINT "sla_targets_pkey" PRIMARY KEY ("sla_id","priority_id")
);

-- CreateTable
CREATE TABLE "ticket_counters" (
    "day" VARCHAR(8) NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "ticket_counters_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "number" VARCHAR(20) NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "state" VARCHAR(20) NOT NULL DEFAULT 'new',
    "priority_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "owner_id" UUID,
    "customer_id" UUID,
    "organization_id" UUID,
    "unverified_from" VARCHAR(254),
    "channel" VARCHAR(20) NOT NULL,
    "pending_until" TIMESTAMPTZ(3),
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "sensitive_data" BOOLEAN NOT NULL DEFAULT false,
    "sla_id" UUID,
    "first_response_due_at" TIMESTAMPTZ(3),
    "first_response_at" TIMESTAMPTZ(3),
    "update_due_at" TIMESTAMPTZ(3),
    "solution_due_at" TIMESTAMPTZ(3),
    "escalation_at" TIMESTAMPTZ(3),
    "sla_warning_at" TIMESTAMPTZ(3),
    "sla_paused_since" TIMESTAMPTZ(3),
    "sla_paused_minutes" INTEGER NOT NULL DEFAULT 0,
    "last_customer_contact_at" TIMESTAMPTZ(3),
    "last_agent_contact_at" TIMESTAMPTZ(3),
    "solved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "time_spent_minutes" INTEGER NOT NULL DEFAULT 0,
    "merged_into_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "search_vector" tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce("number", '')) ||
        to_tsvector('spanish', mesa_unaccent(coalesce("title", ''))) ||
        to_tsvector('english', mesa_unaccent(coalesce("title", '')))
    ) STORED,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_tags" (
    "ticket_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,

    CONSTRAINT "ticket_tags_pkey" PRIMARY KEY ("ticket_id","name")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "sender" VARCHAR(20) NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "from_address" VARCHAR(320),
    "to_addresses" VARCHAR(2000),
    "cc_addresses" VARCHAR(2000),
    "subject" VARCHAR(500),
    "body_html" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "message_id" VARCHAR(500),
    "in_reply_to" VARCHAR(500),
    "references" TEXT,
    "sender_auth" VARCHAR(10),
    "auto_generated" BOOLEAN NOT NULL DEFAULT false,
    "delivery_status" VARCHAR(20),
    "delivery_error" VARCHAR(500),
    "call_direction" VARCHAR(10),
    "call_number" VARCHAR(30),
    "call_duration_sec" INTEGER,
    "call_outcome" VARCHAR(40),
    "sensitive_data" BOOLEAN NOT NULL DEFAULT false,
    "redacted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search_vector" tsvector GENERATED ALWAYS AS (
        to_tsvector('spanish', mesa_unaccent(coalesce("subject", '') || ' ' || left(coalesce("body_text", ''), 100000))) ||
        to_tsvector('english', mesa_unaccent(coalesce("subject", '') || ' ' || left(coalesce("body_text", ''), 100000)))
    ) STORED,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "ticket_id" UUID,
    "article_id" UUID,
    "storage_key" VARCHAR(200) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "scan_status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "scan_detail" VARCHAR(200),
    "sensitive_data" BOOLEAN NOT NULL DEFAULT false,
    "inline" BOOLEAN NOT NULL DEFAULT false,
    "content_id" VARCHAR(250),
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_links" (
    "source_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "type" VARCHAR(10) NOT NULL,

    CONSTRAINT "ticket_links_pkey" PRIMARY KEY ("source_id","target_id")
);

-- CreateTable
CREATE TABLE "ticket_history" (
    "id" BIGSERIAL NOT NULL,
    "ticket_id" UUID NOT NULL,
    "actor_id" UUID,
    "field" VARCHAR(60) NOT NULL,
    "old_value" VARCHAR(500),
    "new_value" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentions" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "ticket_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("ticket_id","user_id")
);

-- CreateTable
CREATE TABLE "shared_drafts" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shared_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "done_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "activity_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "article_id" UUID,
    "user_id" UUID NOT NULL,
    "minutes" INTEGER NOT NULL,
    "activity_type_id" UUID,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "macros" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "actions" JSONB NOT NULL,
    "group_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "macros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_modules" (
    "id" UUID NOT NULL,
    "keyword" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "content" TEXT NOT NULL,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'es-MX',
    "group_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "text_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "fields" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ticket_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overviews" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "conditions" JSONB NOT NULL,
    "columns" TEXT[],
    "order_by" VARCHAR(40) NOT NULL DEFAULT 'updated_at',
    "order_dir" VARCHAR(4) NOT NULL DEFAULT 'desc',
    "roles" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "overviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triggers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "event" VARCHAR(20) NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedulers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "limit_per_run" INTEGER NOT NULL DEFAULT 500,
    "last_run_at" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schedulers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_workflows" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "screens" TEXT[],
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "core_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_attributes" (
    "id" UUID NOT NULL,
    "object" VARCHAR(20) NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "label_en" VARCHAR(120),
    "data_type" VARCHAR(20) NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "visible_to_customer" BOOLEAN NOT NULL DEFAULT false,
    "editable_by_customer" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "object_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_channels" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address" VARCHAR(254) NOT NULL,
    "adapter" VARCHAR(10) NOT NULL,
    "group_id" UUID NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_name" VARCHAR(60),
    "trusted_auth_serv" VARCHAR(200),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_fetch_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postmaster_filters" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "match" JSONB NOT NULL,
    "set" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "postmaster_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_messages" (
    "message_id_hash" CHAR(64) NOT NULL,
    "channel_id" UUID,
    "ticket_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("message_id_hash")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" UUID NOT NULL,
    "call_id" VARCHAR(120) NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "from_number" VARCHAR(30) NOT NULL,
    "to_number" VARCHAR(30) NOT NULL,
    "state" VARCHAR(10) NOT NULL,
    "user_id" UUID,
    "customer_id" UUID,
    "ticket_id" UUID,
    "cause" VARCHAR(40),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ticket_id" UUID,
    "type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_sla_events" (
    "ticket_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_sla_events_pkey" PRIMARY KEY ("ticket_id","kind","due_at")
);

-- CreateTable
CREATE TABLE "data_privacy_tasks" (
    "id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "requested_by_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "result_key" VARCHAR(200),
    "error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "data_privacy_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" UUID NOT NULL,
    "target" VARCHAR(40) NOT NULL,
    "days" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "last_run_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_roles_name_key" ON "custom_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "support_plans_name_key" ON "support_plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "signatures_name_key" ON "signatures"("name");

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_priorities_name_key" ON "ticket_priorities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_priorities_rank_key" ON "ticket_priorities"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "business_calendars_name_key" ON "business_calendars"("name");

-- CreateIndex
CREATE UNIQUE INDEX "slas_name_key" ON "slas"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_state_idx" ON "tickets"("state");

-- CreateIndex
CREATE INDEX "tickets_group_id_state_idx" ON "tickets"("group_id", "state");

-- CreateIndex
CREATE INDEX "tickets_owner_id_state_idx" ON "tickets"("owner_id", "state");

-- CreateIndex
CREATE INDEX "tickets_customer_id_idx" ON "tickets"("customer_id");

-- CreateIndex
CREATE INDEX "tickets_organization_id_idx" ON "tickets"("organization_id");

-- CreateIndex
CREATE INDEX "tickets_sla_warning_at_idx" ON "tickets"("sla_warning_at");

CREATE INDEX "tickets_escalation_at_idx" ON "tickets"("escalation_at");

-- CreateIndex
CREATE INDEX "tickets_pending_until_idx" ON "tickets"("pending_until");

-- CreateIndex
CREATE INDEX "tickets_updated_at_idx" ON "tickets"("updated_at");

-- CreateIndex
CREATE INDEX "ticket_tags_name_idx" ON "ticket_tags"("name");

-- CreateIndex
CREATE INDEX "articles_ticket_id_created_at_idx" ON "articles"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "articles_message_id_idx" ON "articles"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_ticket_id_idx" ON "attachments"("ticket_id");

-- CreateIndex
CREATE INDEX "attachments_scan_status_idx" ON "attachments"("scan_status");

-- CreateIndex
CREATE INDEX "ticket_history_ticket_id_id_idx" ON "ticket_history"("ticket_id", "id");

-- CreateIndex
CREATE INDEX "mentions_user_id_read_at_idx" ON "mentions"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "shared_drafts_ticket_id_idx" ON "shared_drafts"("ticket_id");

-- CreateIndex
CREATE INDEX "checklist_items_ticket_id_position_idx" ON "checklist_items"("ticket_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "activity_types_name_key" ON "activity_types"("name");

-- CreateIndex
CREATE INDEX "time_entries_ticket_id_idx" ON "time_entries"("ticket_id");

-- CreateIndex
CREATE INDEX "time_entries_user_id_created_at_idx" ON "time_entries"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "macros_name_key" ON "macros"("name");

-- CreateIndex
CREATE UNIQUE INDEX "text_modules_keyword_locale_key" ON "text_modules"("keyword", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_templates_name_key" ON "ticket_templates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "overviews_slug_key" ON "overviews"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "triggers_name_key" ON "triggers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "schedulers_name_key" ON "schedulers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "core_workflows_name_key" ON "core_workflows"("name");

-- CreateIndex
CREATE UNIQUE INDEX "object_attributes_object_name_key" ON "object_attributes"("object", "name");

-- CreateIndex
CREATE UNIQUE INDEX "email_channels_name_key" ON "email_channels"("name");

-- CreateIndex
CREATE UNIQUE INDEX "email_channels_address_key" ON "email_channels"("address");

-- CreateIndex
CREATE UNIQUE INDEX "postmaster_filters_name_key" ON "postmaster_filters"("name");

-- CreateIndex
CREATE UNIQUE INDEX "call_logs_call_id_key" ON "call_logs"("call_id");

-- CreateIndex
CREATE INDEX "call_logs_started_at_idx" ON "call_logs"("started_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_target_key" ON "retention_policies"("target");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_mobile_idx" ON "users"("mobile");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_support_plan_id_fkey" FOREIGN KEY ("support_plan_id") REFERENCES "support_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_secondary_organizations" ADD CONSTRAINT "user_secondary_organizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_secondary_organizations" ADD CONSTRAINT "user_secondary_organizations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_custom_roles" ADD CONSTRAINT "user_custom_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_custom_roles" ADD CONSTRAINT "user_custom_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_signature_id_fkey" FOREIGN KEY ("signature_id") REFERENCES "signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_access" ADD CONSTRAINT "group_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_access" ADD CONSTRAINT "group_access_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slas" ADD CONSTRAINT "slas_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "business_calendars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_targets" ADD CONSTRAINT "sla_targets_sla_id_fkey" FOREIGN KEY ("sla_id") REFERENCES "slas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_targets" ADD CONSTRAINT "sla_targets_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "ticket_priorities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "ticket_priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_sla_id_fkey" FOREIGN KEY ("sla_id") REFERENCES "slas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_history" ADD CONSTRAINT "ticket_history_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_drafts" ADD CONSTRAINT "shared_drafts_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_activity_type_id_fkey" FOREIGN KEY ("activity_type_id") REFERENCES "activity_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_sla_events" ADD CONSTRAINT "ticket_sla_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Full-text indexes.
CREATE INDEX "tickets_search_idx" ON "tickets" USING GIN ("search_vector");
CREATE INDEX "articles_search_idx" ON "articles" USING GIN ("search_vector");

-- Ticket history is append-only like the audit log.
CREATE TRIGGER "ticket_history_no_update"
  BEFORE UPDATE ON "ticket_history"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_block_mutation"();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
    REVOKE UPDATE ON "ticket_history" FROM app_rw;
    REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM app_rw;
    REVOKE ALL ON "_prisma_migrations" FROM app_rw;
  END IF;
END;
$$;
