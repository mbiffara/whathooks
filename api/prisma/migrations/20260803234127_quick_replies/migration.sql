-- CreateTable
CREATE TABLE "QuickReply" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuickReply_organizationId_idx" ON "QuickReply"("organizationId");

-- AddForeignKey
ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
