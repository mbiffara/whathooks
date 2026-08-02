-- MirrorThread generalization: session-scoped threads that either a static
-- MirrorLink or a Flow can create. Additive columns first, backfill from the
-- owning link, then tighten constraints.

ALTER TABLE "MirrorThread"
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "humanAgentId" TEXT,
  ADD COLUMN "agentNumber" TEXT,
  ADD COLUMN "showLeadName" BOOLEAN NOT NULL DEFAULT true;

UPDATE "MirrorThread" t
SET "sessionId"   = l."sessionId",
    "humanAgentId" = l."repId",
    "agentNumber" = l."repNumber",
    "showLeadName" = l."showLeadName"
FROM "MirrorLink" l
WHERE t."linkId" = l."id";

ALTER TABLE "MirrorThread"
  ALTER COLUMN "sessionId" SET NOT NULL,
  ALTER COLUMN "agentNumber" SET NOT NULL,
  ALTER COLUMN "linkId" DROP NOT NULL;

DROP INDEX "MirrorThread_linkId_leadJid_key";
DROP INDEX "MirrorThread_linkId_groupJid_key";
CREATE UNIQUE INDEX "MirrorThread_sessionId_leadJid_key" ON "MirrorThread"("sessionId", "leadJid");
CREATE UNIQUE INDEX "MirrorThread_sessionId_groupJid_key" ON "MirrorThread"("sessionId", "groupJid");
CREATE INDEX "MirrorThread_linkId_idx" ON "MirrorThread"("linkId");

ALTER TABLE "MirrorThread"
  ADD CONSTRAINT "MirrorThread_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MirrorThread_humanAgentId_fkey" FOREIGN KEY ("humanAgentId") REFERENCES "SalesRep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Flow tables

CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "graph" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Flow_sessionId_key" ON "Flow"("sessionId");
CREATE INDEX "Flow_organizationId_idx" ON "Flow"("organizationId");
ALTER TABLE "Flow"
  ADD CONSTRAINT "Flow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Flow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FlowConversationState" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "humanAgentId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FlowConversationState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FlowConversationState_conversationId_key" ON "FlowConversationState"("conversationId");
CREATE INDEX "FlowConversationState_flowId_idx" ON "FlowConversationState"("flowId");
ALTER TABLE "FlowConversationState"
  ADD CONSTRAINT "FlowConversationState_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FlowCounter" (
    "flowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FlowCounter_pkey" PRIMARY KEY ("flowId", "nodeId")
);
