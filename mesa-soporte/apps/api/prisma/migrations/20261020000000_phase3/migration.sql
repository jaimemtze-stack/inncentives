-- Phase 3: Inncentives tenant key, AI opt-in per organization, messaging
-- channels (WhatsApp / SMS) and live chat sessions.

ALTER TABLE "organizations"
  ADD COLUMN "ai_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "inncentives_tenant_key" VARCHAR(63);
CREATE UNIQUE INDEX "organizations_inncentives_tenant_key_key" ON "organizations"("inncentives_tenant_key");

ALTER TABLE "articles" ADD COLUMN "external_id" VARCHAR(200);
CREATE UNIQUE INDEX "articles_external_id_key" ON "articles"("external_id");

CREATE TABLE "messaging_channels" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(10) NOT NULL CHECK ("kind" IN ('whatsapp', 'sms')),
    "name" VARCHAR(120) NOT NULL,
    "provider_id" VARCHAR(64) NOT NULL,
    "display_number" VARCHAR(30) NOT NULL,
    "group_id" UUID NOT NULL REFERENCES "groups"("id"),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "messaging_channels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "messaging_channels_kind_provider_id_key" ON "messaging_channels"("kind", "provider_id");

CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL REFERENCES "tickets"("id") ON DELETE CASCADE,
    "customer_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "state" VARCHAR(10) NOT NULL CHECK ("state" IN ('waiting', 'active', 'ended')),
    "agent_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "origin" VARCHAR(10) NOT NULL CHECK ("origin" IN ('portal', 'widget')),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chat_sessions_ticket_id_key" ON "chat_sessions"("ticket_id");
CREATE INDEX "chat_sessions_state_started_at_idx" ON "chat_sessions"("state", "started_at");
CREATE INDEX "chat_sessions_customer_id_state_idx" ON "chat_sessions"("customer_id", "state");
-- At most one open chat per customer.
CREATE UNIQUE INDEX "chat_sessions_one_open_per_customer" ON "chat_sessions"("customer_id") WHERE "state" <> 'ended';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "messaging_channels", "chat_sessions" TO app_rw;
  END IF;
END;
$$;
