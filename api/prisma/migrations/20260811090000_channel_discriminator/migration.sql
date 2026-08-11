-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WHATSAPP', 'INSTAGRAM');

-- AlterTable: every existing session is a Baileys WhatsApp socket. The default
-- keeps that true for rows created by code that predates the column.
ALTER TABLE "WaSession" ADD COLUMN "channel" "Channel" NOT NULL DEFAULT 'WHATSAPP';

-- AlterTable: provider-owned identity for non-WhatsApp channels. All null for
-- WhatsApp, where phoneNumber/creds/signalKeys carry the identity instead.
ALTER TABLE "WaSession" ADD COLUMN "externalAccountId" TEXT;
ALTER TABLE "WaSession" ADD COLUMN "externalProfileId" TEXT;
ALTER TABLE "WaSession" ADD COLUMN "externalHandle" TEXT;

-- CreateIndex: inbound webhooks land on one shared endpoint for the whole
-- platform, so this is the only thing that routes an event to an organization.
-- Postgres treats NULLs as distinct, so every WhatsApp row is exempt.
CREATE UNIQUE INDEX "WaSession_externalAccountId_key" ON "WaSession"("externalAccountId");
