-- CreateTable
CREATE TABLE "MirrorLink" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "repNumber" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MirrorLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MirrorThread" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "leadJid" TEXT NOT NULL,
    "groupJid" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MirrorThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MirrorLink_sessionId_key" ON "MirrorLink"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "MirrorThread_linkId_leadJid_key" ON "MirrorThread"("linkId", "leadJid");

-- CreateIndex
CREATE UNIQUE INDEX "MirrorThread_linkId_groupJid_key" ON "MirrorThread"("linkId", "groupJid");

-- AddForeignKey
ALTER TABLE "MirrorLink" ADD CONSTRAINT "MirrorLink_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MirrorThread" ADD CONSTRAINT "MirrorThread_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "MirrorLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

