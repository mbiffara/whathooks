-- DropForeignKey
ALTER TABLE "Flow" DROP CONSTRAINT "Flow_sessionId_fkey";

-- AlterTable
ALTER TABLE "Flow" ALTER COLUMN "sessionId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

