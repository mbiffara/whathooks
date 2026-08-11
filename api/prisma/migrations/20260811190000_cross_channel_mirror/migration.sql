-- Cross-channel mirror: the lead and the group need not live on the same
-- session any more. MirrorThread.sessionId keeps meaning "the session hosting
-- the group" (always WhatsApp, the only channel where a business account can
-- open a multi-party thread); the lead side becomes an explicit conversation
-- reference, so a lead on Instagram can be mirrored into a WhatsApp group.

-- AlterTable
ALTER TABLE "MirrorThread" ADD COLUMN "conversationId" TEXT;

-- AlterTable: which WhatsApp session creates groups for this link. NULL means
-- the link's own session, which is the only option when the link is itself on
-- WhatsApp, so every existing row is already correct.
ALTER TABLE "MirrorLink" ADD COLUMN "groupSessionId" TEXT;

-- Backfill: every thread that exists today has its lead on the same session as
-- its group, so (sessionId, leadJid) identifies the conversation exactly. Runs
-- before any cross-channel thread can exist, so there is nothing ambiguous to
-- resolve.
UPDATE "MirrorThread" mt
SET "conversationId" = c."id"
FROM "Conversation" c
WHERE c."sessionId" = mt."sessionId"
  AND c."remoteJid" = mt."leadJid"
  AND mt."conversationId" IS NULL;

-- CreateIndex: a conversation can only be mirrored into one group at a time.
CREATE UNIQUE INDEX "MirrorThread_conversationId_key" ON "MirrorThread"("conversationId");

-- AddForeignKey
ALTER TABLE "MirrorThread" ADD CONSTRAINT "MirrorThread_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
