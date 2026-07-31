-- AlterTable
ALTER TABLE "MirrorLink" ADD COLUMN     "repId" TEXT;

-- CreateTable
CREATE TABLE "SalesRep" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesRep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesRep_phoneNumber_key" ON "SalesRep"("phoneNumber");

-- AddForeignKey
ALTER TABLE "MirrorLink" ADD CONSTRAINT "MirrorLink_repId_fkey" FOREIGN KEY ("repId") REFERENCES "SalesRep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

