-- An organization-owned file library. Until now a stored file only existed
-- attached to the message it arrived in, so nothing automated could send a
-- catalogue or a price list. The sendMedia flow node and the agents'
-- send_media tool both reference these rows by id.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "allowSendMedia" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MediaLibraryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaLibraryItem_organizationId_idx" ON "MediaLibraryItem"("organizationId");

-- AddForeignKey
ALTER TABLE "MediaLibraryItem" ADD CONSTRAINT "MediaLibraryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
