-- Outgoing webhooks, business-hours schedulers and personal API tokens.

-- AlterTable
ALTER TABLE "schedulers" ADD COLUMN     "calendar_id" UUID;

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "secret_enc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_status" INTEGER,
    "last_error" VARCHAR(500),
    "last_called_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhooks_name_key" ON "webhooks"("name");

-- AddForeignKey
ALTER TABLE "schedulers" ADD CONSTRAINT "schedulers_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "business_calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "webhooks" TO app_rw;
  END IF;
END;
$$;

-- Personal API tokens (hash only).
CREATE TABLE "api_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens"("user_id");
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "api_tokens" TO app_rw;
  END IF;
END;
$$;
