-- AlterTable: purchased tokens carry over between months.
ALTER TABLE "Organization" ADD COLUMN "paidAiTokens" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: fire the low-balance warning once per period.
ALTER TABLE "AiTokenUsage" ADD COLUMN "lowAlertSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiTokenDailyUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT,
    "day" TIMESTAMP(3) NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTokenDailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTokenPurchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "stripeSessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTokenPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTokenDailyUsage_organizationId_agentId_day_key" ON "AiTokenDailyUsage"("organizationId", "agentId", "day");
CREATE INDEX "AiTokenDailyUsage_organizationId_day_idx" ON "AiTokenDailyUsage"("organizationId", "day");
CREATE UNIQUE INDEX "AiTokenPurchase_stripeSessionId_key" ON "AiTokenPurchase"("stripeSessionId");
CREATE INDEX "AiTokenPurchase_organizationId_idx" ON "AiTokenPurchase"("organizationId");

-- AddForeignKey
ALTER TABLE "AiTokenDailyUsage" ADD CONSTRAINT "AiTokenDailyUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTokenDailyUsage" ADD CONSTRAINT "AiTokenDailyUsage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTokenPurchase" ADD CONSTRAINT "AiTokenPurchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
