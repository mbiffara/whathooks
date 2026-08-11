-- AlterTable: optional channel filter on outbound webhooks. NULL = all channels.
ALTER TABLE "Webhook" ADD COLUMN "channel" "Channel";

-- Backfill: every webhook that exists today was written against WhatsApp
-- payloads, where `from` is a phone jid. Instagram's is an opaque provider id,
-- so silently widening these endpoints would break live integrations. Pinning
-- existing rows makes Instagram opt-in; new webhooks may choose NULL for all
-- channels. Runs before any Instagram session can exist, so it cannot strand
-- a subscriber who actually wanted both.
UPDATE "Webhook" SET "channel" = 'WHATSAPP' WHERE "channel" IS NULL;
