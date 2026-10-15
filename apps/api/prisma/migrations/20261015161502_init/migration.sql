-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('invited', 'active', 'blocked');

-- CreateEnum
CREATE TYPE "MfaPolicy" AS ENUM ('disabled', 'recommended', 'required');

-- CreateEnum
CREATE TYPE "GroupAccessLevel" AS ENUM ('read', 'create', 'change', 'overview', 'full');

-- CreateEnum
CREATE TYPE "OneTimeTokenPurpose" AS ENUM ('invitation', 'password_reset');

-- CreateEnum
CREATE TYPE "ArticleType" AS ENUM ('email', 'phone', 'note', 'web', 'system');

-- CreateEnum
CREATE TYPE "ArticleVisibility" AS ENUM ('public', 'internal');

-- CreateEnum
CREATE TYPE "ArticleSender" AS ENUM ('customer', 'agent', 'system');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('none', 'queued', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('pending', 'clean', 'infected', 'error');

-- CreateEnum
CREATE TYPE "TicketLinkType" AS ENUM ('parent', 'child', 'related');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domains" TEXT[],
    "supportPlanId" UUID,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mfaPolicy" "MfaPolicy" NOT NULL DEFAULT 'recommended',
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "firstname" TEXT NOT NULL,
    "lastname" TEXT NOT NULL,
    "phones" TEXT[],
    "phoneDigits" TEXT[],
    "locale" TEXT NOT NULL DEFAULT 'es-MX',
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "status" "UserStatus" NOT NULL DEFAULT 'invited',
    "passwordHash" TEXT,
    "passwordChangedAt" TIMESTAMPTZ(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEnc" TEXT,
    "mfaRecoveryCodes" TEXT[],
    "organizationId" UUID,
    "sharedOrganization" BOOLEAN NOT NULL DEFAULT false,
    "notificationPrefs" JSONB NOT NULL DEFAULT '{}',
    "outOfOffice" BOOLEAN NOT NULL DEFAULT false,
    "outOfOfficeStart" DATE,
    "outOfOfficeEnd" DATE,
    "outOfOfficeReplacementId" UUID,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "anonymizedAt" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_secondary_organizations" (
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,

    CONSTRAINT "user_secondary_organizations_pkey" PRIMARY KEY ("userId","organizationId")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "emailAddress" TEXT,
    "signatureId" UUID,
    "autoAssignment" BOOLEAN NOT NULL DEFAULT false,
    "isVerification" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_access" (
    "userId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "levels" "GroupAccessLevel"[],

    CONSTRAINT "group_access_pkey" PRIMARY KEY ("userId","groupId")
);

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "OneTimeTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "known_devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_states" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "isPending" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ticket_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_priorities" (
    "id" UUID NOT NULL,
    "value" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ticket_priorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_counters" (
    "day" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ticket_counters_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stateId" UUID NOT NULL,
    "priorityId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "ownerId" UUID,
    "customerId" UUID NOT NULL,
    "organizationId" UUID,
    "tags" TEXT[],
    "pendingUntil" TIMESTAMPTZ(3),
    "slaId" UUID,
    "firstResponseAt" TIMESTAMPTZ(3),
    "firstResponseDueAt" TIMESTAMPTZ(3),
    "updateDueAt" TIMESTAMPTZ(3),
    "solutionDueAt" TIMESTAMPTZ(3),
    "escalationAt" TIMESTAMPTZ(3),
    "lastContactAt" TIMESTAMPTZ(3),
    "lastContactCustomerAt" TIMESTAMPTZ(3),
    "lastContactAgentAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "timeAccountedMinutes" INTEGER NOT NULL DEFAULT 0,
    "mergedIntoId" UUID,
    "needsVerification" BOOLEAN NOT NULL DEFAULT false,
    "containsSensitiveData" BOOLEAN NOT NULL DEFAULT false,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_pauses" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3),

    CONSTRAINT "sla_pauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "type" "ArticleType" NOT NULL,
    "visibility" "ArticleVisibility" NOT NULL,
    "sender" "ArticleSender" NOT NULL,
    "authorId" UUID,
    "from" TEXT,
    "to" TEXT,
    "cc" TEXT,
    "subject" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "messageId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT[],
    "emailHeaders" JSONB,
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'none',
    "deliveryError" TEXT,
    "callDirection" TEXT,
    "callNumber" TEXT,
    "callDurationSec" INTEGER,
    "callResult" TEXT,
    "containsSensitiveData" BOOLEAN NOT NULL DEFAULT false,
    "redactedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "articleId" UUID,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'pending',
    "scanDetail" TEXT,
    "possibleSensitiveData" BOOLEAN NOT NULL DEFAULT false,
    "sensitiveFindings" JSONB,
    "inline" BOOLEAN NOT NULL DEFAULT false,
    "contentId" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_links" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "type" "TicketLinkType" NOT NULL,

    CONSTRAINT "ticket_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentions" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "ticketId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("ticketId","userId")
);

-- CreateTable
CREATE TABLE "shared_drafts" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shared_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklists" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "name" TEXT,

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_activity_types" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "time_activity_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "articleId" UUID,
    "agentId" UUID NOT NULL,
    "minutes" INTEGER NOT NULL,
    "activityTypeId" UUID,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "macros" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "perform" JSONB NOT NULL,
    "groupIds" UUID[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "macros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_modules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es-MX',
    "content" TEXT NOT NULL,
    "groupIds" UUID[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "text_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ticket_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overviews" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "condition" JSONB NOT NULL,
    "columns" TEXT[],
    "orderBy" TEXT NOT NULL DEFAULT 'created_at',
    "orderDir" TEXT NOT NULL DEFAULT 'asc',
    "groupBy" TEXT,
    "roleIds" UUID[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "overviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triggers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "activator" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "perform" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedulers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timeplan" JSONB NOT NULL,
    "condition" JSONB NOT NULL,
    "perform" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMPTZ(3),

    CONSTRAINT "schedulers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core_workflows" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "screens" TEXT[],
    "condition" JSONB NOT NULL,
    "perform" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 500,
    "stopAfterMatch" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "core_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_calendars" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "business_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_plans" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "includedHoursMonthly" INTEGER,
    "hourlyRateCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'MXN',

    CONSTRAINT "support_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slas" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "targets" JSONB NOT NULL,
    "warningPercent" INTEGER NOT NULL DEFAULT 80,
    "pauseOnPending" BOOLEAN NOT NULL DEFAULT true,
    "calendarId" UUID NOT NULL,
    "supportPlanId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "slas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_attributes" (
    "id" UUID NOT NULL,
    "object" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display" JSONB NOT NULL,
    "dataType" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "builtIn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "object_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postmaster_filters" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "match" JSONB NOT NULL,
    "perform" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "postmaster_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "customPayload" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "webhookId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "secretsEnc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" UUID NOT NULL,
    "locales" TEXT[],

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_categories" (
    "id" UUID NOT NULL,
    "kbId" UUID NOT NULL,
    "parentId" UUID,
    "titles" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "kb_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_answers" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "publishAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "kb_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_answer_translations" (
    "id" UUID NOT NULL,
    "answerId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kb_answer_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "objectType" TEXT,
    "objectId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "correlationId" TEXT,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "histories" (
    "id" BIGSERIAL NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" UUID NOT NULL,
    "actorId" UUID,
    "attribute" TEXT,
    "valueFrom" TEXT,
    "valueTo" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_name_key" ON "organizations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE INDEX "users_phoneDigits_idx" ON "users" USING GIN ("phoneDigits");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "groups_name_key" ON "groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_tokens_tokenHash_key" ON "one_time_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "one_time_tokens_userId_purpose_idx" ON "one_time_tokens"("userId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "known_devices_userId_fingerprint_key" ON "known_devices"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_states_name_key" ON "ticket_states"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_priorities_value_key" ON "ticket_priorities"("value");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_priorities_name_key" ON "ticket_priorities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "tickets_groupId_stateId_idx" ON "tickets"("groupId", "stateId");

-- CreateIndex
CREATE INDEX "tickets_customerId_idx" ON "tickets"("customerId");

-- CreateIndex
CREATE INDEX "tickets_organizationId_idx" ON "tickets"("organizationId");

-- CreateIndex
CREATE INDEX "tickets_ownerId_idx" ON "tickets"("ownerId");

-- CreateIndex
CREATE INDEX "tickets_escalationAt_idx" ON "tickets"("escalationAt");

-- CreateIndex
CREATE INDEX "tickets_tags_idx" ON "tickets" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "sla_pauses_ticketId_idx" ON "sla_pauses"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "articles_messageId_key" ON "articles"("messageId");

-- CreateIndex
CREATE INDEX "articles_ticketId_createdAt_idx" ON "articles"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "articles_inReplyTo_idx" ON "articles"("inReplyTo");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_articleId_idx" ON "attachments"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_links_sourceId_targetId_type_key" ON "ticket_links"("sourceId", "targetId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "mentions_ticketId_userId_key" ON "mentions"("ticketId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "checklists_ticketId_key" ON "checklists"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "time_activity_types_name_key" ON "time_activity_types"("name");

-- CreateIndex
CREATE INDEX "time_entries_ticketId_idx" ON "time_entries"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "macros_name_key" ON "macros"("name");

-- CreateIndex
CREATE UNIQUE INDEX "text_modules_keyword_locale_key" ON "text_modules"("keyword", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_templates_name_key" ON "ticket_templates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "signatures_name_key" ON "signatures"("name");

-- CreateIndex
CREATE UNIQUE INDEX "overviews_link_key" ON "overviews"("link");

-- CreateIndex
CREATE UNIQUE INDEX "triggers_name_key" ON "triggers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "schedulers_name_key" ON "schedulers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "core_workflows_name_key" ON "core_workflows"("name");

-- CreateIndex
CREATE UNIQUE INDEX "business_calendars_name_key" ON "business_calendars"("name");

-- CreateIndex
CREATE UNIQUE INDEX "support_plans_name_key" ON "support_plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "slas_name_key" ON "slas"("name");

-- CreateIndex
CREATE UNIQUE INDEX "object_attributes_object_name_key" ON "object_attributes"("object", "name");

-- CreateIndex
CREATE UNIQUE INDEX "postmaster_filters_name_key" ON "postmaster_filters"("name");

-- CreateIndex
CREATE UNIQUE INDEX "webhooks_name_key" ON "webhooks"("name");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookId_createdAt_idx" ON "webhook_deliveries"("webhookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_kind_key" ON "integrations"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "kb_answer_translations_answerId_locale_key" ON "kb_answer_translations"("answerId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_hash_key" ON "audit_logs"("hash");

-- CreateIndex
CREATE INDEX "audit_logs_occurredAt_idx" ON "audit_logs"("occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_objectType_objectId_idx" ON "audit_logs"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "histories_objectType_objectId_idx" ON "histories"("objectType", "objectId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_supportPlanId_fkey" FOREIGN KEY ("supportPlanId") REFERENCES "support_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_outOfOfficeReplacementId_fkey" FOREIGN KEY ("outOfOfficeReplacementId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_secondary_organizations" ADD CONSTRAINT "user_secondary_organizations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_secondary_organizations" ADD CONSTRAINT "user_secondary_organizations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_access" ADD CONSTRAINT "group_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_access" ADD CONSTRAINT "group_access_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "ticket_states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "ticket_priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_slaId_fkey" FOREIGN KEY ("slaId") REFERENCES "slas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_pauses" ADD CONSTRAINT "sla_pauses_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_drafts" ADD CONSTRAINT "shared_drafts_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "time_activity_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slas" ADD CONSTRAINT "slas_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "business_calendars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slas" ADD CONSTRAINT "slas_supportPlanId_fkey" FOREIGN KEY ("supportPlanId") REFERENCES "support_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_kbId_fkey" FOREIGN KEY ("kbId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_categories" ADD CONSTRAINT "kb_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "kb_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_answers" ADD CONSTRAINT "kb_answers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "kb_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_answer_translations" ADD CONSTRAINT "kb_answer_translations_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "kb_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
