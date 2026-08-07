-- AlterTable: included-AI agents store no key of their own.
ALTER TABLE "Agent" ADD COLUMN "useIncludedAi" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ALTER COLUMN "apiKeyCiphertext" DROP NOT NULL;
ALTER TABLE "Agent" ALTER COLUMN "apiKeyHint" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AiTokenUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTokenUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTokenUsage_organizationId_period_key" ON "AiTokenUsage"("organizationId", "period");

-- AddForeignKey
ALTER TABLE "AiTokenUsage" ADD CONSTRAINT "AiTokenUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
