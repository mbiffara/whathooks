-- CreateTable
CREATE TABLE "AgentKnowledgeDoc" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "charCount" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentKnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentKnowledgeDoc_agentId_idx" ON "AgentKnowledgeDoc"("agentId");

-- AddForeignKey
ALTER TABLE "AgentKnowledgeDoc" ADD CONSTRAINT "AgentKnowledgeDoc_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
