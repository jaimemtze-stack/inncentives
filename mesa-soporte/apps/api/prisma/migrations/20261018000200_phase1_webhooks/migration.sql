-- Outgoing webhooks for triggers and business-hours restriction for schedulers.

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
