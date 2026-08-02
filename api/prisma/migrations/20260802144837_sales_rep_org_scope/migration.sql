-- DropIndex
DROP INDEX "SalesRep_phoneNumber_key";

-- AlterTable
ALTER TABLE "SalesRep" ADD COLUMN     "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "SalesRep_organizationId_idx" ON "SalesRep"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesRep_organizationId_phoneNumber_key" ON "SalesRep"("organizationId", "phoneNumber");

-- AddForeignKey
ALTER TABLE "SalesRep" ADD CONSTRAINT "SalesRep_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: attach legacy (pre-org-scoping) reps to the org that owns the
-- session of their mirror link.
UPDATE "SalesRep" r
SET "organizationId" = s."organizationId"
FROM "MirrorLink" l
JOIN "WaSession" s ON s."id" = l."sessionId"
WHERE l."repId" = r."id" AND r."organizationId" IS NULL;
