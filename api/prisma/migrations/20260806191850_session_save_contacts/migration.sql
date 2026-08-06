-- AlterTable
ALTER TABLE "WaSession" ADD COLUMN     "saveContacts" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "_ContactToWaSession" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ContactToWaSession_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ContactToWaSession_B_index" ON "_ContactToWaSession"("B");

-- AddForeignKey
ALTER TABLE "_ContactToWaSession" ADD CONSTRAINT "_ContactToWaSession_A_fkey" FOREIGN KEY ("A") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContactToWaSession" ADD CONSTRAINT "_ContactToWaSession_B_fkey" FOREIGN KEY ("B") REFERENCES "WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
