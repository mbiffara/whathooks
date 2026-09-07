-- A contact can belong to one human agent. Businesses that already know who
-- looks after whom import their book with that column filled, and the
-- "assign to the contact's agent" flow node routes an inbound DM straight
-- to that person. The FK targets "SalesRep": HumanAgent keeps its legacy
-- table name (@@map).

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "humanAgentId" TEXT;

-- CreateIndex
CREATE INDEX "Contact_organizationId_humanAgentId_idx" ON "Contact"("organizationId", "humanAgentId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_humanAgentId_fkey" FOREIGN KEY ("humanAgentId") REFERENCES "SalesRep"("id") ON DELETE SET NULL ON UPDATE CASCADE;
