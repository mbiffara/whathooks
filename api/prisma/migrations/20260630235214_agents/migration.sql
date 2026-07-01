-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('CONTACT', 'HUMAN', 'API', 'AGENT');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "source" "MessageSource" NOT NULL DEFAULT 'CONTACT';

-- AlterTable
ALTER TABLE "WaSession" ADD COLUMN     "agentId" TEXT;

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "soul" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'claude-opus-4-8',
    "maxTokens" INTEGER NOT NULL DEFAULT 1024,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agent_organizationId_idx" ON "Agent"("organizationId");

-- CreateIndex
CREATE INDEX "WaSession_agentId_idx" ON "WaSession"("agentId");

-- AddForeignKey
ALTER TABLE "WaSession" ADD CONSTRAINT "WaSession_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
