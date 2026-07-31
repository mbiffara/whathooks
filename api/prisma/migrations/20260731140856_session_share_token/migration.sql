-- AlterTable
ALTER TABLE "WaSession" ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "shareTokenCreatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "WaSession_shareToken_key" ON "WaSession"("shareToken");

